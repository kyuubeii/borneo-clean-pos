import { db } from "./db";
/** In-app notifications only — no email/SMS provider is configured in v1. */
export async function notify(n: { userId?: string | null; type: string; title: string; body?: string; link?: string }) {
  try { await db.notification.create({ data: { userId: n.userId ?? null, type: n.type, title: n.title, body: n.body, link: n.link } }); }
  catch { /* never break the request */ }
}
