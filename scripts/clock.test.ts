/**
 * The server's day boundaries are Kuching's, even on a UTC machine like Vercel.
 * Run with TZ=UTC through `npm run test:polish`. Touches no database.
 */
import assert from "node:assert/strict";

async function main() {
  assert.equal(process.env.TZ, "UTC", "run with TZ=UTC to stand in for Vercel");
  const { startOfDay, endOfDay, startOfMonth, endOfMonth, isoDate } = await import("../src/lib/dates");
  const utcStart = startOfDay(new Date("2026-10-02")).toISOString();
  const { useBusinessClock } = await import("../src/lib/clock");
  useBusinessClock();

  let passed = 0;
  const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };

  check("without it, a UTC server's day starts at 8am Kuching", () => assert.equal(utcStart, "2026-10-02T00:00:00.000Z"));
  check("a day is the Kuching day", () => {
    assert.equal(startOfDay(new Date("2026-10-02")).toISOString(), "2026-10-01T16:00:00.000Z");
    assert.equal(endOfDay(new Date("2026-10-02")).toISOString(), "2026-10-02T15:59:59.999Z");
  });
  check("a 12:00 am job is on its own date, in the day view and today", () => {
    const job = new Date("2026-10-01T16:00:00Z"); // 12:00 am 2 Oct in Kuching
    const gte = startOfDay(new Date("2026-10-02")), lte = endOfDay(new Date("2026-10-02"));
    assert.ok(job >= gte && job <= lte);
    assert.equal(isoDate(job), "2026-10-02");
  });
  check("a month is the Kuching month", () => {
    assert.equal(startOfMonth(new Date("2026-10-15")).toISOString(), "2026-09-30T16:00:00.000Z");
    assert.equal(endOfMonth(new Date("2026-10-15")).toISOString(), "2026-10-31T15:59:59.999Z");
  });
  console.log(`\n${passed} clock checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
