import { db } from "./db";
import { schedulePush } from "./push";
import { BUSINESS_TZ, businessClock, businessDayStart } from "./dates";

/** How far ahead a reminder can be set, in days, as offered in Settings. */
export const REMINDER_DAYS = [1, 3] as const;

/**
 * Which reminders are on. Stored as "1,3"; an empty string means none.
 * A database that has never saved the setting gets the day-before reminder,
 * the same default the settings page shows.
 */
export async function reminderDays(): Promise<number[]> {
  const row = await db.setting.findUnique({ where: { key: "reminders.days" } });
  const raw = row ? row.value : "1";
  return raw.split(",").map(Number).filter((n) => (REMINDER_DAYS as readonly number[]).includes(n));
}

const when = (d: Date) => d.toLocaleString("en-MY", {
  timeZone: BUSINESS_TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
});

/**
 * Remind the team of bookings coming up 1 and/or 3 days from today, on the
 * Kuching calendar. Run once a day by the cron.
 *
 * Safe to run more than once: each reminder's id is made from the booking, the
 * lead time and the day it falls on, so a second run -- a retry, or the spare
 * Vercel project's cron against the same database -- finds it already there and
 * sends nothing. A booking moved to another day gets a fresh reminder.
 */
export async function sendBookingReminders(now = new Date()) {
  const days = await reminderDays();
  const today = businessClock(now).date;
  const sent: string[] = [];
  for (const n of days) {
    const gte = businessDayStart(today, n), lt = businessDayStart(today, n + 1);
    const bookings = await db.booking.findMany({
      where: { startAt: { gte, lt }, status: { in: ["PENDING", "CONFIRMED"] } },
      include: { customer: true, job: { include: { assignments: { include: { staff: true }, orderBy: { isLead: "desc" } } } } },
      orderBy: { startAt: "asc" },
    });
    for (const b of bookings) {
      if (b.job?.status === "CANCELLED") continue;
      const team = b.job?.assignments.map((a) => a.staff.name) ?? [];
      const id = `rem-${b.id}-${n}d-${businessClock(b.startAt).date}`;
      try {
        await db.notification.create({ data: {
          id, type: "REMINDER",
          title: `${n === 1 ? "Tomorrow" : `In ${n} days`}: booking ${b.ref}`,
          body: `${b.customer.name} · ${when(b.startAt)} · ${team.length ? team.join(", ") : "no cleaner assigned"}`,
          link: `/bookings/${b.id}`,
        } });
      } catch (e: any) {
        if (e?.code === "P2002") continue; // already reminded
        throw e;
      }
      schedulePush(id);
      sent.push(`${b.ref} (${n}d)`);
    }
  }
  return { today, days, sent };
}
