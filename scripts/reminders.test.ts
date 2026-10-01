/**
 * Booking reminders against a disposable SQLite copy of the schema. Never
 * imports the live client. APNs is not configured here, so nothing is pushed.
 * Run through `npm run test:polish`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function main() {
  const path = process.env.POLISH_TEST_CLIENT;
  if (!path || !path.includes("borneo-polish-test")) throw new Error("Use npm run test:polish; an isolated client is required.");
  const { PrismaClient } = require(path);
  const client = new PrismaClient();
  (globalThis as any).prisma = client;
  for (const k of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY"]) delete process.env[k];

  const { sendBookingReminders } = await import("../src/lib/reminders");

  let passed = 0;
  async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }

  await client.notification.deleteMany({ where: { type: "REMINDER" } });
  await client.setting.deleteMany({ where: { key: "reminders.days" } });
  const c = await client.customer.create({ data: { name: "Reminder Test" } });
  let n = 0;
  const booking = (startAt: string, status = "CONFIRMED") =>
    client.booking.create({ data: { ref: `RT-${++n}`, customerId: c.id, startAt: new Date(startAt), status } });

  // 11am on 1 Oct in Kuching.
  const now = new Date("2026-10-01T03:00:00Z");
  const tomorrowMorning = await booking("2026-10-02T01:00:00Z");   // 9am 2 Oct
  const tomorrowEarly = await booking("2026-10-01T17:00:00Z");     // 1am 2 Oct -- still 1 Oct in UTC
  await booking("2026-10-01T15:00:00Z");                           // 11pm 1 Oct: today, not tomorrow
  await booking("2026-10-02T04:00:00Z", "CANCELLED");              // tomorrow, but cancelled
  const inThree = await booking("2026-10-04T02:00:00Z");           // 10am 4 Oct

  const refs = (r: { sent: string[] }) => r.sent.map((s) => s.split(" ")[0]).sort();

  await check("with nothing saved, only the day-before reminder goes, on the Kuching date", async () => {
    const r = await sendBookingReminders(now);
    assert.equal(r.today, "2026-10-01");
    assert.deepEqual(r.days, [1]);
    assert.deepEqual(refs(r), [tomorrowMorning.ref, tomorrowEarly.ref].sort());
    const row = await client.notification.findFirst({ where: { link: `/bookings/${tomorrowMorning.id}` } });
    assert.equal(row.type, "REMINDER");
    assert.match(row.title, /^Tomorrow: booking RT-/);
    assert.match(row.body, /Reminder Test · .*9:00.*am · no cleaner assigned/i);
  });

  await check("a second run, or the other project's cron, sends nothing again", async () => {
    const r = await sendBookingReminders(now);
    assert.deepEqual(r.sent, []);
    assert.equal(await client.notification.count({ where: { type: "REMINDER" } }), 2);
  });

  await check("3 days before, when switched on", async () => {
    await client.setting.create({ data: { key: "reminders.days", value: "1,3" } });
    const r = await sendBookingReminders(now);
    assert.deepEqual(refs(r), [inThree.ref]);
    const row = await client.notification.findFirst({ where: { link: `/bookings/${inThree.id}` } });
    assert.match(row.title, /^In 3 days: booking /);
  });

  await check("a booking moved to another day is reminded again", async () => {
    await client.booking.update({ where: { id: inThree.id }, data: { startAt: new Date("2026-10-02T06:00:00Z") } });
    const r = await sendBookingReminders(now);
    assert.deepEqual(refs(r), [inThree.ref]);
  });

  await check("ticking neither turns reminders off", async () => {
    await client.setting.update({ where: { key: "reminders.days" }, data: { value: "" } });
    const r = await sendBookingReminders(new Date("2026-10-02T03:00:00Z"));
    assert.deepEqual(r.days, []);
    assert.deepEqual(r.sent, []);
  });

  await client.notification.deleteMany({ where: { type: "REMINDER" } });
  await client.booking.deleteMany({ where: { customerId: c.id } });
  await client.customer.delete({ where: { id: c.id } });
  await client.setting.deleteMany({ where: { key: "reminders.days" } });
  await client.$disconnect();
  console.log(`\n${passed} reminder checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
