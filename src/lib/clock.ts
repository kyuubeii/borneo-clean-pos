import { BUSINESS_TZ } from "./dates";

/**
 * Run the server on the Kuching clock.
 *
 * Vercel runs in UTC, eight hours behind. Every "start of day", "end of month"
 * and "today" the server worked out was a UTC day, so a job at 12:00 am to
 * 7:59 am Kuching time fell on the previous date: it went missing from the
 * calendar's day view and the dashboard's today, and sat in the wrong day or
 * month in the reports. Node re-reads TZ whenever it is assigned, so setting it
 * here moves all of the server's date arithmetic to the business's clock.
 * Kuching has no daylight saving, so this never shifts during the year.
 */
export function useBusinessClock() {
  if (process.env.TZ !== BUSINESS_TZ) process.env.TZ = BUSINESS_TZ;
}
