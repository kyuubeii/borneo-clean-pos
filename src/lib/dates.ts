export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
export const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
export const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth()+n); return x; };
export const startOfWeek = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
export const startOfMonth = (d: Date) => { const x = startOfDay(d); x.setDate(1); return x; };
export const endOfMonth = (d: Date) => endOfDay(addDays(addMonths(startOfMonth(d), 1), -1));
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const fmtTime = (d: Date) => d.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", hour12: true });
export const fmtDate = (d: Date) => d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (d: Date) => `${fmtDate(d)} · ${fmtTime(d)}`;

/** The business's clock. The server runs on UTC, so text it writes for people names this zone. */
export const BUSINESS_TZ = "Asia/Kuching";
/** A date and time as the office reads it, for text the server writes (notifications). */
export const fmtStamp = (d: Date) => d.toLocaleString("en-MY", { timeZone: BUSINESS_TZ });

/** The date, 24-hour time and weekday on the Kuching clock, whatever the server's zone. */
export function businessClock(d: Date) {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, ...o }).format(d);
  const [dd, mm, yyyy] = part({ day: "2-digit", month: "2-digit", year: "numeric" }).split("/");
  return { date: `${yyyy}-${mm}-${dd}`, time: part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), weekday: part({ weekday: "long" }) };
}
/**
 * The instant a day on the Kuching clock begins, `days` after the given
 * Kuching date. Kuching has no daylight saving, so it is always UTC+8.
 */
export const businessDayStart = (date: string, days = 0) =>
  new Date(new Date(`${date}T00:00:00+08:00`).getTime() + days * 86400000);
export const toInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const minsToLabel = (m: number) => m >= 60 ? `${Math.floor(m/60)}h${m%60 ? ` ${m%60}m` : ""}` : `${m}m`;

/**
 * Local-calendar YYYY-MM-DD. Never use toISOString().slice(0,10) for this:
 * it converts to UTC first, which shifts period boundaries by a day.
 */
export const isoDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
