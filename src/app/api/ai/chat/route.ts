import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { runAction, toolSchemas, getAction, resolveAction } from "@/lib/actions";
import { aiConfig, chatCompletion, getSetting, type ORMessage } from "@/lib/openrouter";
import { PENDING, CONTEXT_MESSAGES, contextWindow, titleFrom, systemPrompt } from "@/lib/chat";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

export const maxDuration = 60;

/** Fill in a placeholder tool message, in the DB and in the in-flight message list. */
async function resolveToolMessage(threadId: string, toolCallId: string | undefined, payload: string, messages: ORMessage[]) {
  if (!toolCallId) return;
  await db.chatMessage.updateMany({ where: { threadId, toolCalls: toolCallId }, data: { content: payload } });
  const existing = messages.find((m) => m.role === "tool" && m.tool_call_id === toolCallId);
  if (existing) existing.content = payload;
  else messages.push({ role: "tool", content: payload, tool_call_id: toolCallId });
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const { threadId, message, confirm } = await req.json();

  // A conversation belongs to the person who started it. This is checked before
  // anything else, including the confirm path, which executes an action.
  if (threadId) {
    const owned = await db.chatThread.findUnique({ where: { id: threadId }, select: { userId: true } });
    if (!owned || owned.userId !== user.id) return NextResponse.json({ ok: false, error: "That conversation no longer exists." }, { status: 404 });
  } else if (!message) {
    return NextResponse.json({ ok: false, error: "Nothing to send." }, { status: 400 });
  }

  const { key, model, configured } = await aiConfig();
  if (!configured) {
    return NextResponse.json({ ok: false, error: "NO_API_KEY",
      message: "No OpenRouter API key is configured. Add one under Settings → AI Assistant." }, { status: 400 });
  }

  const thread: string = threadId || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let title: string | undefined;
  if (!threadId) {
    title = titleFrom(message);
    await db.chatThread.create({ data: { id: thread, userId: user.id, title } });
  } else {
    // Most recently used first in the history list.
    await db.chatThread.update({ where: { id: thread }, data: { updatedAt: new Date() } });
  }
  const business = await getSetting("business.name", "Borneo Clean Services");

  // Rebuild the conversation from stored history so follow-ups keep their context.
  // The newest messages, not the oldest: a long thread used to replay its first
  // sixty and silently lose everything said since.
  const latest = await db.chatMessage.findMany({ where: { threadId: thread }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CONTEXT_MESSAGES });
  const history = contextWindow(latest.reverse());
  const messages: ORMessage[] = [{ role: "system", content: systemPrompt(user, business) }];
  for (const m of history) {
    if (m.role === "tool") messages.push({ role: "tool", content: m.content, tool_call_id: m.toolCalls ?? undefined });
    else if (m.role === "assistant") messages.push({ role: "assistant", content: m.content || null, ...(m.toolCalls ? { tool_calls: JSON.parse(m.toolCalls) } : {}) });
    else messages.push({ role: "user", content: m.content });
  }

  const events: any[] = [];

  // A confirmed action resumes the loop: run it, record the result, let the model narrate.
  if (confirm?.action) {
    const res = await runAction(confirm.action, confirm.input, { user, source: "assistant" }, { confirmed: true });
    const payload = JSON.stringify(res.ok ? { ok: true, result: (res as any).data } : { ok: false, error: (res as any).error });
    await resolveToolMessage(thread, confirm.toolCallId, payload, messages);
    events.push({ type: "action", name: confirm.action, ok: res.ok, result: res.ok ? (res as any).data : (res as any).error });
  } else if (confirm?.cancelled && confirm?.toolCallId) {
    // The user declined. Close the open tool call so the thread stays valid.
    const payload = JSON.stringify({ ok: false, error: "The user declined this action. Nothing was changed." });
    await resolveToolMessage(thread, confirm.toolCallId, payload, messages);
  } else if (message) {
    await db.chatMessage.create({ data: { threadId: thread, role: "user", content: message } });
    messages.push({ role: "user", content: message });
  }

  const tools = toolSchemas(user);

  try {
    // Tool-calling loop. Bounded so a confused model cannot spin forever.
    for (let step = 0; step < 8; step++) {
      const reply = await chatCompletion({ messages, tools, model, apiKey: key });

      if (!reply.tool_calls?.length) {
        const text = reply.content ?? "";
        await db.chatMessage.create({ data: { threadId: thread, role: "assistant", content: text } });
        return NextResponse.json({ ok: true, threadId: thread, title, message: text, events });
      }

      messages.push(reply);
      await db.chatMessage.create({ data: {
        threadId: thread, role: "assistant", content: reply.content ?? "",
        toolCalls: JSON.stringify(reply.tool_calls) } });

      // Every tool_call must have a matching tool message or OpenRouter rejects the
      // next turn. Write placeholders now and resolve them as each call completes,
      // so the thread stays valid however this loop exits (gate, error, cancel).
      for (const call of reply.tool_calls) {
        await db.chatMessage.create({ data: { threadId: thread, role: "tool",
          content: PENDING, toolCalls: call.id } });
      }

      for (const call of reply.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        // The model sees "customers_search"; the registry knows "customers.search".
        const def = resolveAction(call.function.name);
        const actionName = def?.name ?? call.function.name;
        const res = await runAction(actionName, args, { user, source: "assistant" });

        // Risky action — hand it back to the user to confirm, and pause the loop here.
        // Any tool calls after this one in the same reply keep their placeholder result.
        // History stays valid (that is what the placeholders are for); the model simply
        // sees "awaiting confirmation" for calls that never ran, which is accurate.
        if (!res.ok && (res as any).needsConfirm) {
          return NextResponse.json({ ok: true, threadId: thread, title, message: reply.content ?? "",
            events,
            confirm: {
              action: actionName, input: (res as any).input, toolCallId: call.id,
              title: def?.description ?? actionName, category: def?.category,
            } });
        }

        const payload = JSON.stringify(res.ok ? { ok: true, result: (res as any).data } : { ok: false, error: (res as any).error });
        const trimmed = payload.length > 12000 ? payload.slice(0, 12000) + '…","truncated":true}' : payload;
        messages.push({ role: "tool", content: trimmed, tool_call_id: call.id });
        await db.chatMessage.updateMany({ where: { threadId: thread, toolCalls: call.id, content: PENDING },
          data: { content: trimmed } });
        events.push({ type: "action", name: actionName, ok: res.ok, readOnly: def?.readOnly ?? false });
      }
    }
    return NextResponse.json({ ok: true, threadId: thread, title, events,
      message: "That needed more steps than I can take in one go. Could you narrow the request a little?" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, threadId: thread, title, error: e?.message ?? "Assistant error" }, { status: 500 });
  }
}
