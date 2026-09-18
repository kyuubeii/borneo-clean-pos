import { db } from "./db";

export async function audit(entry: {
  userId?: string | null; actorName?: string; action: string;
  source?: "ui" | "assistant" | "system";
  entity?: string; entityId?: string; payload?: unknown; result?: unknown; ok?: boolean;
}) {
  const trim = (v: unknown) => {
    if (v === undefined) return null;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 4000 ? s.slice(0, 4000) + "…" : s;
  };
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actorName: entry.actorName ?? "system",
        action: entry.action,
        source: entry.source ?? "ui",
        entity: entry.entity, entityId: entry.entityId,
        payload: trim(entry.payload), result: trim(entry.result),
        ok: entry.ok ?? true,
      },
    });
  } catch { /* audit must never break the request */ }
}
