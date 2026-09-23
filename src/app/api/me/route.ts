import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

/**
 * The signed-in person, as the app layout hands it to the web pages.
 *
 * The web gets this from the server-rendered layout. The iPhone app has no
 * layout render, so it asks here -- for the role that decides its navigation
 * and the staff link a cleaner needs to check in. Read-only, and it says no
 * more than the layout already puts in the page.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, staffId: user.staffId ?? null } });
}
