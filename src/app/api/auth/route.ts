import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const user = await db.user.findUnique({ where: { email: String(email ?? "").toLowerCase().trim() } });
  if (!user || !user.active || user.password !== hashPassword(String(password ?? ""))) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }
  await createSession(user.id);
  await audit({ userId: user.id, actorName: user.name, action: "auth.signIn", source: "ui" });
  return NextResponse.json({ ok: true, role: user.role });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
