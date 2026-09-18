import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { runAction } from "@/lib/actions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
  const { name } = await params;
  let input: unknown = {};
  try { input = await req.json(); } catch { /* empty body is fine */ }
  const result = await runAction(name, input, { user, source: "ui" });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
