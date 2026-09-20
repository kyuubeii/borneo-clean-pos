/** Integration checks against a disposable SQLite copy of the app schema. Never imports the live client. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function main() {
  const path = process.env.POLISH_TEST_CLIENT;
  if (!path || !path.includes("borneo-polish-test")) throw new Error("Use npm run test:polish; an isolated client is required.");
  const { PrismaClient } = require(path);
  const client = new PrismaClient();
  (globalThis as any).prisma = client;
  const { getAction } = await import("../src/lib/registry");
  await import("../src/lib/actions");
  const { slotReason } = await import("../src/lib/scheduling");
  const ctx: any = { user: { id: "test", role: "OWNER", name: "Test" }, source: "system" };
  const act = async (name: string, input: any) => {
    const a = getAction(name)!;
    return await a.handler(a.input.parse(input), ctx) as any;
  };
  let passed = 0;
  async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }
  try {
    const c = await client.customer.create({ data: { name: "Polish test" } });
    const service = await client.service.create({ data: { name: "Cleaning", priceCents: 10000, durationMin: 120 } });
    const worker = await client.staff.create({ data: { name: "Cleaner A" } });
    const worker2 = await client.staff.create({ data: { name: "Cleaner B" } });
    const start = "2031-05-05T02:00:00.000Z";
    const b = await act("bookings.create", { customerId: c.id, serviceIds: [service.id], startAt: start, staffIds: [worker.id] });
    const job = await client.job.findUnique({ where: { bookingId: b.booking.id } });
    await check("conflicting booking is rejected without leaving a partial booking", async () => {
      const count = await client.booking.count();
      await assert.rejects(act("bookings.create", { customerId: c.id, serviceIds: [service.id], startAt: start, staffIds: [worker.id] }), /Already on job/);
      assert.equal(await client.booking.count(), count);
    });
    await check("availability excludes the current job", async () => {
      const rows = await act("staff.findAvailable", { startAt: start, durationMin: 120, excludeJobId: job.id });
      assert.equal(rows.find((r: any) => r.staffId === worker.id).available, true);
    });
    await check("cancel through status editor synchronizes job and closes time", async () => {
      await client.timeEntry.create({ data: { jobId: job.id, staffId: worker.id, startAt: new Date() } });
      await act("bookings.updateStatus", { bookingId: b.booking.id, status: "CANCELLED" });
      assert.equal((await client.job.findUnique({ where: { id: job.id } })).status, "CANCELLED");
      assert.equal(await client.timeEntry.count({ where: { jobId: job.id, endAt: null } }), 0);
    });
    await check("reopening and completing stay synchronized in both directions", async () => {
      await act("bookings.updateStatus", { bookingId: b.booking.id, status: "CONFIRMED" });
      await act("jobs.updateStatus", { jobId: job.id, status: "COMPLETED" });
      assert.equal((await client.booking.findUnique({ where: { id: b.booking.id } })).status, "COMPLETED");
      await act("jobs.updateStatus", { jobId: job.id, status: "SCHEDULED" });
      assert.equal((await client.booking.findUnique({ where: { id: b.booking.id } })).status, "CONFIRMED");
      assert.equal((await client.job.findUnique({ where: { id: job.id } })).completedAt, null);
    });
    await check("calendar moves preserve the complete chosen team and booking date", async () => {
      await act("jobs.move", { jobId: job.id, scheduledAt: "2031-05-06T02:00:00Z", staffIds: [worker.id, worker2.id] });
      assert.equal(await client.jobAssignment.count({ where: { jobId: job.id } }), 2);
      assert.equal((await client.booking.findUnique({ where: { id: b.booking.id } })).startAt.toISOString(), "2031-05-06T02:00:00.000Z");
    });
    await check("duplicate or invalid team cannot remove an existing assignment", async () => {
      await assert.rejects(act("jobs.assignStaff", { jobId: job.id, staffIds: [worker.id, worker.id] }));
      await assert.rejects(act("jobs.assignStaff", { jobId: job.id, staffIds: ["missing"] }));
      assert.equal(await client.jobAssignment.count({ where: { jobId: job.id } }), 2);
    });
    await check("booking duration and instructions synchronize to the job", async () => {
      await act("bookings.update", { bookingId: b.booking.id, durationMin: 90, notes: "Kitchen" });
      const updated = await client.job.findUnique({ where: { id: job.id } });
      assert.equal(updated.durationMin, 90); assert.equal(updated.customerInstructions, "Kitchen");
    });
    await check("booking editor saves fields and status atomically", async () => {
      await act("bookings.update", { bookingId: b.booking.id, notes: "Finished", status: "COMPLETED" });
      const updated = await client.job.findUnique({ where: { id: job.id } });
      assert.equal(updated.status, "COMPLETED"); assert.equal(updated.customerInstructions, "Finished");
      await act("bookings.update", { bookingId: b.booking.id, status: "CONFIRMED" });
    });
    await check("job duration updates its booking", async () => {
      await act("jobs.update", { jobId: job.id, durationMin: 120 });
      assert.equal((await client.booking.findUnique({ where: { id: b.booking.id } })).durationMin, 120);
    });
    const q = await act("quotes.create", { customerId: c.id, items: [{ name: "Cleaning", serviceId: service.id, qty: 1, priceCents: 10000 }, { name: "Custom windows", qty: 2, priceCents: 2500 }], discountCents: 1000, taxRateBp: 600 });
    await check("draft quote cannot be converted", async () => { await assert.rejects(act("quotes.convertToBooking", { quoteId: q.id, startAt: start }), /Accept/); });
    await act("quotes.updateStatus", { quoteId: q.id, status: "ACCEPTED" });
    const converted = await act("quotes.convertToBooking", { quoteId: q.id, startAt: start });
    const qb = await client.booking.findUnique({ where: { ref: converted.bookingRef } });
    const qj = await client.job.findUnique({ where: { bookingId: qb.id } });
    await check("booking display retains custom quoted lines and discounted total", async () => {
      const detail = await act("bookings.get", { bookingId: qb.id });
      assert.equal(detail.items.length, 2); assert.equal(detail.totalCents, 14840);
    });
    await check("quote invoice retains custom lines, discount and tax", async () => {
      const result = await act("invoices.createFromJob", { jobId: qj.id });
      const invoice = await client.invoice.findUnique({ where: { id: result.invoiceId }, include: { items: true } });
      assert.equal(invoice.items.length, 2); assert.equal(invoice.discountCents, 1000); assert.equal(invoice.taxRateBp, 600);
      assert.equal(result.total, 14840);
    });
    await check("repeat conversion and invoice creation are rejected", async () => {
      await assert.rejects(act("quotes.convertToBooking", { quoteId: q.id, startAt: start }), /already/);
      await assert.rejects(act("invoices.createFromJob", { jobId: qj.id }), /already/);
    });
    await check("paginated bookings do not repeat records", async () => {
      const a = await act("bookings.list", { limit: 1, offset: 0, direction: "desc" });
      const b = await act("bookings.list", { limit: 1, offset: 1, direction: "desc" });
      assert.equal(a.length, 1); assert.equal(b.length, 1); assert.notEqual(a[0].id, b[0].id);
    });
    await check("Malaysia hours and overnight overlap are checked", () => {
      const staff = { id: "a", availability: [{ weekday: 1, startMin: 540, endMin: 1020 }] };
      assert.equal(slotReason(staff, [], new Date(start), 120), null);
      assert.equal(slotReason(staff, [], new Date("2031-05-05T00:00:00Z"), 120), "Outside working hours");
      assert.match(slotReason({ id: "a", availability: [] }, [{ ref: "NIGHT", scheduledAt: new Date("2031-05-04T15:00:00Z"), durationMin: 180, assignments: [{ staffId: "a" }] }], new Date("2031-05-04T16:00:00Z"), 60)!, /NIGHT/);
    });
    await check("recurring conflict rolls back the entire series", async () => {
      const count = await client.booking.count();
      await assert.rejects(act("bookings.create", { customerId: c.id, serviceIds: [service.id], staffIds: [worker.id], startAt: "2031-04-29T02:00:00Z", recurrence: "WEEKLY", recurUntil: "2031-05-07T00:00:00Z" }), /Already on job/);
      assert.equal(await client.booking.count(), count);
    });
    console.log(`${passed} integration checks passed. SQLite isolation does not validate PostgreSQL concurrency behavior.`);
  } finally { await client.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
