/**
 * Assistant conversation helpers shared by the chat and history routes.
 * Nothing here talks to the database, so it can be tested on plain arrays.
 */

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
