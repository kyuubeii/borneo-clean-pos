import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { listNotifications, setReceipts } from "@/lib/notify";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ items: [], unread: 0 });
  return NextResponse.json(await listNotifications(user.id));
}

/**
 * The bell's own read/dismiss calls. These go here rather than through the
 * action registry so that opening the bell does not write an audit-log row
 * every time; the assistant has notifications.markRead / .dismiss for the same.
 *
 * Body: { op: "read" | "dismiss", id?: string } -- no id means all of them.
 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const op = body?.op === "dismiss" ? "dismiss" : "read";
  const id = typeof body?.id === "string" && body.id ? body.id : undefined;
  const count = await setReceipts(user.id, op === "dismiss" ? { dismissed: true } : { read: true }, id);
  return NextResponse.json({ ok: true, count });
}
