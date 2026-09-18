import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { runAction, toolSchemas, getAction } from "@/lib/actions";
import { aiConfig, chatCompletion, getSetting, type ORMessage } from "@/lib/openrouter";

export const maxDuration = 60;

function systemPrompt(user: { name: string; role: string }, business: string) {
  const now = new Date();
  return `You are the operations assistant for ${business}, a cleaning business in Kuching, Sarawak, Malaysia.

You are talking to ${user.name} (role: ${user.role}). You operate the application on their behalf by calling tools.

CURRENT CONTEXT
- Now: ${now.toString()}
- Today's date: ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString("en-MY", { weekday: "long" })})
- Currency: Malaysian Ringgit (RM). All monetary values in tool inputs and outputs are INTEGER CENTS. RM 120 is 12000. Always show money to the user as "RM 120.00", never as cents.
- Timezone: local. When the user says "tomorrow at 2pm", resolve it to a concrete ISO datetime yourself before calling a tool.

HOW TO WORK
- Resolve names to IDs first. If the user says "John", call customers.search, then use the returned id. Never invent an ID.
- Prefer taking the action over describing how to take it. You have real write access.
- Chain tools freely to finish a multi-step request in one turn (e.g. search customer, list services, then create the booking).
- If a request is genuinely ambiguous (two customers named Tan, no date given), ask one short clarifying question instead of guessing.
- Some tools require confirmation. When one does, the system returns a confirmation request and the user is shown a confirm/cancel prompt. Do not try to bypass it and do not re-call the tool yourself — just wait for the outcome.
- Follow-up references are relative to what you last showed. "the second one" means the second item in your previous list — use the id from that list.

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
  const thread: string = threadId || `t_${Date.now()}`;
  const { key, model, configured } = await aiConfig();
  if (!configured) {
    return NextResponse.json({ ok: false, error: "NO_API_KEY",
      message: "No OpenRouter API key is configured. Add one under Settings → AI Assistant." }, { status: 400 });
  }
  const business = await getSetting("business.name", "Borneo Clean Services");

  // Rebuild the conversation from stored history so follow-ups keep their context.
  const history = await db.chatMessage.findMany({ where: { threadId: thread }, orderBy: { createdAt: "asc" }, take: 60 });
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
    await db.chatMessage.create({ data: { threadId: thread, role: "tool", content: payload, toolCalls: confirm.toolCallId ?? null } });
    messages.push({ role: "tool", content: payload, tool_call_id: confirm.toolCallId ?? "confirmed" });
    events.push({ type: "action", name: confirm.action, ok: res.ok, result: res.ok ? (res as any).data : (res as any).error });
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
        return NextResponse.json({ ok: true, threadId: thread, message: text, events });
      }

      messages.push(reply);
      await db.chatMessage.create({ data: {
        threadId: thread, role: "assistant", content: reply.content ?? "",
        toolCalls: JSON.stringify(reply.tool_calls) } });

      for (const call of reply.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        const res = await runAction(call.function.name, args, { user, source: "assistant" });

        // Risky action — hand it back to the user to confirm, and pause the loop here.
        if (!res.ok && (res as any).needsConfirm) {
          const def = getAction(call.function.name);
          return NextResponse.json({ ok: true, threadId: thread, message: reply.content ?? "",
            events,
            confirm: {
              action: call.function.name, input: (res as any).input, toolCallId: call.id,
              title: def?.description ?? call.function.name, category: def?.category,
            } });
        }

        const payload = JSON.stringify(res.ok ? { ok: true, result: (res as any).data } : { ok: false, error: (res as any).error });
        const trimmed = payload.length > 12000 ? payload.slice(0, 12000) + '…","truncated":true}' : payload;
        messages.push({ role: "tool", content: trimmed, tool_call_id: call.id });
        await db.chatMessage.create({ data: { threadId: thread, role: "tool", content: trimmed, toolCalls: call.id } });
        events.push({ type: "action", name: call.function.name, ok: res.ok, readOnly: getAction(call.function.name)?.readOnly ?? false });
      }
    }
    return NextResponse.json({ ok: true, threadId: thread, events,
      message: "That needed more steps than I can take in one go. Could you narrow the request a little?" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Assistant error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { threadId } = await req.json();
  if (threadId) await db.chatMessage.deleteMany({ where: { threadId } });
  return NextResponse.json({ ok: true });
}
