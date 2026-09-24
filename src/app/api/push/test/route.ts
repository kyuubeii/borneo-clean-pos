import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { testPush } from "@/lib/push";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

/**
 * Send a test push to the signed-in person's own phones and return Apple's
 * answer for each. Only ever reaches the caller, so any signed-in role may
 * use it; nothing is written to the bell or the audit log.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await testPush(user.id)) });
}
