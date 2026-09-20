import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

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
  if (!user) return NextResponse.json({ items: [] });
  const items = await db.notification.findMany({
    where: { OR: [{ userId: null }, { userId: user.id }] },
    orderBy: { createdAt: "desc" }, take: 20,
  });
  return NextResponse.json({ items });
}

export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await db.notification.updateMany({ where: { OR: [{ userId: null }, { userId: user.id }] }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
