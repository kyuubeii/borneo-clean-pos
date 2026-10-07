/**
 * Assistant conversation helpers shared by the chat and history routes.
 * Nothing here talks to the database, so it can be tested on plain values.
 */

import { businessClock } from "./dates";

/** Placeholder written for a tool call that has not run yet. */
export const PENDING = JSON.stringify({ ok: false, error: "Awaiting user confirmation." });

/** How many stored messages are replayed to the model on each turn. */
export const CONTEXT_MESSAGES = 60;

type Row = { role: string; content: string; toolCalls: string | null };

/** A conversation's title, from the first thing the person asked. */
export function titleFrom(message: string) {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || "New chat";
}

/**
 * The tail of a conversation to send to the model.
 *
 * `rows` is the newest CONTEXT_MESSAGES, oldest first. Cutting a thread at an
 * arbitrary point can start the slice on a tool result, or on an assistant
 * message whose tool results were cut off -- both of which the API rejects --
 * so the slice is advanced to the first user message.
 */
export function contextWindow<T extends { role: string }>(rows: T[]): T[] {
  const first = rows.findIndex((r) => r.role === "user");
  return first <= 0 ? (first === 0 ? rows : []) : rows.slice(first);
}

export type DisplayMsg = { role: "user" | "assistant"; content: string; actions?: { name: string; ok: boolean }[] };

/**
 * Turn stored rows back into what the chat panel showed at the time: the
 * person's messages, the assistant's replies, and a badge for each action it
 * ran. Tool calls still awaiting confirmation, or that were declined, ran
 * nothing and so get no badge.
 */
export function toDisplay(rows: Row[], actionName: (toolName: string) => string): DisplayMsg[] {
  const out: DisplayMsg[] = [];
  const names = new Map<string, string>();
  let actions: { name: string; ok: boolean }[] = [];
  let interim = "";
  const flush = () => {
    if (actions.length || interim) out.push({ role: "assistant", content: interim, actions });
    actions = []; interim = "";
  };
  for (const m of rows) {
    if (m.role === "user") { flush(); out.push({ role: "user", content: m.content }); continue; }
    if (m.role === "assistant") {
      if (m.toolCalls) {
        try { for (const c of JSON.parse(m.toolCalls)) names.set(c.id, actionName(c.function?.name ?? "")); } catch {}
        // Text alongside a tool call is what was on screen when a turn paused
        // for confirmation; a later final reply replaces it.
        if (m.content) interim = m.content;
      } else {
        out.push({ role: "assistant", content: m.content, actions });
        actions = []; interim = "";
      }
      continue;
    }
    if (m.role === "tool") {
      if (m.content === PENDING) continue;
      let ok = false, declined = false;
      try { const r = JSON.parse(m.content); ok = !!r.ok; declined = !r.ok && /declined/i.test(String(r.error ?? "")); }
      // A long result is cut short when stored, which leaves it unparseable.
      catch { ok = m.content.startsWith('{"ok":true'); }
      if (declined) continue;
      actions.push({ name: names.get(m.toolCalls ?? "") ?? "action", ok });
    }
  }
  flush();
  return out;
}

/** What the assistant is told at the start of every turn. */
export function systemPrompt(user: { name: string; role: string }, business: string, at = new Date()) {
  // Everything the user says is on Kuching time; spell it out rather than rely on the server's clock.
  const now = businessClock(at);
  return `You are the operations assistant for ${business}, a cleaning business in Kuching, Sarawak, Malaysia.

You are talking to ${user.name} (role: ${user.role}). You operate the application on their behalf by calling tools.

CURRENT CONTEXT
- Now: ${now.date} ${now.time}, Kuching time (UTC+08:00)
- Today's date: ${now.date} (${now.weekday})
- Currency: Malaysian Ringgit (RM). All monetary values in tool inputs and outputs are INTEGER CENTS. RM 120 is 12000. Always show money to the user as "RM 120.00", never as cents.
- Timezone: Asia/Kuching, UTC+08:00, no daylight saving. Every time the user mentions is Kuching time. When the user says "tomorrow at 2pm", resolve it yourself to an ISO datetime WITH the +08:00 offset before calling a tool, e.g. "2026-01-15T14:00:00+08:00" — never a bare time or a "Z" time. For a from/to date range, pass plain Kuching dates like "2026-01-15".

HOW TO WORK
- Resolve names to IDs first. If the user says "John", call customers_search, then use the returned id. Never invent an ID.
- If the user mentions a reference code (BKG-0184, JOB-0137, INV-0042, QT-0001, PAY-0100, EXP-0012, PO-0001, RMB-0003, CAP-0001), call lookup_byRef with it. Do not page through lists hunting for it.
- If you are unsure which kind of record is meant, call search_global once rather than trying several list tools.
- Prefer one precise call over several broad ones. Do not call the same tool repeatedly with different filters hoping to stumble on a record.
- Prefer taking the action over describing how to take it. You have real write access.
- Chain tools freely to finish a multi-step request in one turn (e.g. search customer, list services, then create the booking).
- If a request is genuinely ambiguous (two customers named Tan, no date given), ask one short clarifying question instead of guessing.
- Some tools require confirmation. When one does, the system returns a confirmation request and the user is shown a confirm/cancel prompt. Do not try to bypass it and do not re-call the tool yourself — just wait for the outcome.
- List tools return at most what fits in one reply; filter them (customerId, status, unpaidOnly, from/to) instead of asking for everything.
- To combine several of one customer's invoices into one bill, list them with invoices_list (customerId, unpaidOnly) and pass their refs to invoices_merge.
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
