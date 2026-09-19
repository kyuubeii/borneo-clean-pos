import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { supabaseServer, authConfigured } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

/**
 * Sign in and out.
 *
 * Supabase Auth verifies the password; this route exists so the session
 * cookies are written server-side. The app's own User row still supplies the
 * role and the staff link, and an inactive account is refused here even when
 * the credentials are valid.
 */
export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ ok: false, error: "Sign-in is not configured on this server." }, { status: 503 });
  }

  const { email, password } = await req.json();
  const supabase = await supabaseServer();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email ?? "").toLowerCase().trim(),
    password: String(password ?? ""),
  });
  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { authUserId: data.user.id } });
  if (!user || !user.active) {
    // Valid credentials, but no usable account here -- drop the session again
    // so a deactivated user is not left holding one.
    await supabase.auth.signOut();
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  await audit({ userId: user.id, actorName: user.name, action: "auth.signIn", source: "ui" });
  return NextResponse.json({ ok: true, role: user.role });
}

export async function DELETE() {
  if (authConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  return NextResponse.json({ ok: true });
}
