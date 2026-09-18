import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

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
