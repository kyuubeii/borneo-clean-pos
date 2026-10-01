import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { sendBookingReminders } from "@/lib/reminders";

/** Run next to the database, like every other route (see vercel.json). */
export const preferredRegion = "sin1";
export const dynamic = "force-dynamic";

/**
 * Booking reminders, called once a day by the Vercel cron in vercel.json.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set
 * on the project; without it the cron is refused. The owner or an admin may
 * also open it while signed in to send any that are due now -- it is safe to
 * repeat, as each reminder is only ever sent once.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bySchedule = Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!bySchedule) {
    const user = await getUser();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await sendBookingReminders()) });
}
