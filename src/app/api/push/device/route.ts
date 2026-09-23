import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { PUSH_TYPES, defaultTypes } from "@/lib/push";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

const Register = z.object({
  token: z.string().regex(/^[0-9a-f]{32,200}$/i, "Not a device token"),
  environment: z.enum(["sandbox", "production"]).default("production"),
  platform: z.string().max(20).default("ios"),
  types: z.array(z.enum(PUSH_TYPES)).optional(),
});

const show = (d: { types: string; environment: string }) =>
  ({ types: d.types ? d.types.split(",") : [], environment: d.environment });

/**
 * Register this phone for push, or change which types it is sent.
 *
 * The phone calls this on every launch with its token; `types` is sent only
 * when the person changes their choice, so a relaunch never resets it. A new
 * phone starts from its role's defaults. A token that was registered by
 * someone else moves to whoever is signed in now -- the phone changed hands.
 *
 * These are the signed-in person's own preferences, like the bell's
 * read/dismiss state, so they are kept out of the action registry and the
 * audit log for the same reason.
 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = Register.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { token, environment, platform, types } = parsed.data;

  const existing = await db.pushDevice.findUnique({ where: { token } });
  const keep = existing && existing.userId === user.id ? existing.types : defaultTypes(user.role).join(",");
  const device = await db.pushDevice.upsert({
    where: { token },
    create: { token, userId: user.id, environment, platform, types: types ? types.join(",") : keep },
    update: { userId: user.id, environment, platform, types: types ? types.join(",") : keep },
  });
  return NextResponse.json({ ok: true, device: show(device) });
}

/** Signing out: this phone stops receiving pushes for this person. */
export async function DELETE(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const { count } = await db.pushDevice.deleteMany({ where: { token, userId: user.id } });
  return NextResponse.json({ ok: true, removed: count });
}
