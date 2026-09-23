import { db } from "./db";
import { schedulePush } from "./push";

/**
 * In-app notifications, and a push copy to phones running the iPhone app.
 * No email/SMS provider is configured in v1.
 *
 * The push is sent after the response, keyed on the new row's id, so a
 * notification written inside a transaction that is later rolled back is
 * never pushed.
 */
export async function notify(n: { userId?: string | null; type: string; title: string; body?: string; link?: string }, client: any = db) {
  try {
    const row = await client.notification.create({ data: { userId: n.userId ?? null, type: n.type, title: n.title, body: n.body, link: n.link } });
    schedulePush(row.id);
  }
  catch { /* never break the request */ }
}

/** The bell only looks back this far, so old news drops off on its own. */
export const NOTIFICATION_DAYS = 30;

/**
 * Notifications this person can see and has not dismissed.
 *
 * Read and dismissed live in NotificationReceipt, one row per person, because
 * almost every notification is broadcast (userId null): a flag on the row itself
 * meant the first person to clear the bell cleared it for everyone.
 */
export function visibleTo(userId: string) {
  return {
    OR: [{ userId: null }, { userId }],
    createdAt: { gte: new Date(Date.now() - NOTIFICATION_DAYS * 86400000) },
    NOT: { receipts: { some: { userId, dismissed: true } } },
  };
}

/** What the bell's badge counts: visible, not dismissed, not yet read. */
export function unreadCount(userId: string) {
  return db.notification.count({ where: { ...visibleTo(userId), AND: { NOT: { receipts: { some: { userId, read: true } } } } } });
}

export async function listNotifications(userId: string, take = 30) {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: visibleTo(userId), orderBy: { createdAt: "desc" }, take,
      include: { receipts: { where: { userId }, select: { read: true } } },
    }),
    unreadCount(userId),
  ]);
  return {
    items: rows.map(({ receipts, ...n }) => ({ ...n, read: receipts[0]?.read ?? false })),
    unread,
  };
}

/**
 * Mark one notification, or every visible one, read or dismissed for this person.
 * Dismissing also marks it read, so a dismissed item never counts as unread.
 */
export async function setReceipts(userId: string, change: { read?: true; dismissed?: true }, notificationId?: string) {
  const data = { read: true, ...(change.dismissed ? { dismissed: true } : {}) };
  // Only ever notifications this person can see, which also rules out an id
  // that belongs to someone else or no longer exists.
  const ids = (await db.notification.findMany({
    where: { ...visibleTo(userId), ...(notificationId ? { id: notificationId } : {}) }, select: { id: true },
  })).map((n) => n.id);
  if (!ids.length) return 0;
  const have = new Set((await db.notificationReceipt.findMany({
    where: { userId, notificationId: { in: ids } }, select: { notificationId: true },
  })).map((r) => r.notificationId));
  const missing = ids.filter((id) => !have.has(id));
  await db.notificationReceipt.updateMany({ where: { userId, notificationId: { in: ids.filter((id) => have.has(id)) } }, data });
  if (missing.length) {
    try { await db.notificationReceipt.createMany({ data: missing.map((notificationId) => ({ userId, notificationId, ...data })) }); }
    catch (e: any) {
      // Two tabs clearing at the same moment can race to create the same
      // receipt. The other one already wrote it; make sure it says the same.
      if (e?.code !== "P2002") throw e;
      await db.notificationReceipt.updateMany({ where: { userId, notificationId: { in: missing } }, data });
    }
  }
  return ids.length;
}
