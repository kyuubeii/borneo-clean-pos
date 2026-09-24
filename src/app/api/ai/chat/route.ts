import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { runAction, toolSchemas, getAction, resolveAction } from "@/lib/actions";
import { aiConfig, chatCompletion, getSetting, type ORMessage } from "@/lib/openrouter";
import { businessClock } from "@/lib/dates";
import { PENDING, CONTEXT_MESSAGES, contextWindow, titleFrom } from "@/lib/chat";

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

function systemPrompt(user: { name: string; role: string }, business: string) {
  // The server runs on UTC; the business, and everything the user says, is on Kuching time.
  const now = businessClock(new Date());
  return `You are the operations assistant for ${business}, a cleaning business in Kuching, Sarawak, Malaysia.

You are talking to ${user.name} (role: ${user.role}). You operate the application on their behalf by calling tools.

CURRENT CONTEXT
- Now: ${now.date} ${now.time}, Kuching time (UTC+08:00)
- Today's date: ${now.date} (${now.weekday})
- Currency: Malaysian Ringgit (RM). All monetary values in tool inputs and outputs are INTEGER CENTS. RM 120 is 12000. Always show money to the user as "RM 120.00", never as cents.
- Timezone: Asia/Kuching, UTC+08:00, no daylight saving. Every time the user mentions is Kuching time. When the user says "tomorrow at 2pm", resolve it yourself to an ISO datetime WITH the +08:00 offset before calling a tool, e.g. "2026-01-15T14:00:00+08:00" — never a bare time or a "Z" time. For a from/to date range, pass plain Kuching dates like "2026-01-15".

HOW TO WORK
- Resolve names to IDs first. If the user says "John", call customers_search, then use the returned id. Never invent an ID.
- If the user mentions a reference code (BKG-0184, JOB-0137, INV-0042, QT-0001, PAY-0100, EXP-0012, PO-0001), call lookup_byRef with it. Do not page through lists hunting for it.
- If you are unsure which kind of record is meant, call search_global once rather than trying several list tools.
- Prefer one precise call over several broad ones. Do not call the same tool repeatedly with different filters hoping to stumble on a record.
- Prefer taking the action over describing how to take it. You have real write access.
- Chain tools freely to finish a multi-step request in one turn (e.g. search customer, list services, then create the booking).
- If a request is genuinely ambiguous (two customers named Tan, no date given), ask one short clarifying question instead of guessing.
- Some tools require confirmation. When one does, the system returns a confirmation request and the user is shown a confirm/cancel prompt. Do not try to bypass it and do not re-call the tool yourself — just wait for the outcome.
- Follow-up references are relative to what you last showed. "the second one" means the second item in your previous list — use the id from that list.

TOOL NAMES
- Tools are named with underscores (customers_search, bookings_create, lookup_byRef). Use exactly the names you are given.

STYLE
- Be brief and concrete, like a good operations manager. Lead with the answer.
- Format lists as short markdown bullets with the key facts: time, customer, status, amount.
- After you change something, state plainly what changed in one line.
- Reply in the same language the user writes in. If they write Chinese, answer in Chinese.
- Never fabricate data. If a tool returns nothing, say so.`;
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
