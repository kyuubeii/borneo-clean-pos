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
    await check("a declined quote cannot be converted", async () => {
      await act("quotes.updateStatus", { quoteId: q.id, status: "DECLINED" });
      await assert.rejects(act("quotes.convertToBooking", { quoteId: q.id, startAt: start }), /declined/);
      await assert.rejects(act("quotes.convertToInvoice", { quoteId: q.id }), /declined/);
    });
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
    /* ---- Job costing: labour, materials and job expenses, linked everywhere ---- */
    const cw = await client.staff.create({ data: { name: "Costing A", payType: "HOURLY", payRate: 1000 } });
    const cw2 = await client.staff.create({ data: { name: "Costing B", payType: "PER_JOB", payRate: 0 } });
    const cb = await act("bookings.create", { customerId: c.id, serviceIds: [service.id], startAt: "2031-06-02T02:00:00.000Z", staffIds: [cw.id] });
    const cj = await client.job.findUnique({ where: { bookingId: cb.booking.id } });
    const other = await act("bookings.create", { customerId: c.id, serviceIds: [service.id], startAt: "2031-06-09T02:00:00.000Z" });
    const otherJob = await client.job.findUnique({ where: { bookingId: other.booking.id } });
    const strayExpense = await act("expenses.record", { amountCents: 500, jobId: otherJob.id });
    await act("jobs.updateStatus", { jobId: cj.id, status: "COMPLETED" });
    await check("costing with no labour set falls back to the pay rate on scheduled time", async () => {
      const k = await act("jobs.costing", { jobId: cj.id });
      assert.equal(k.labourCents, 2000); assert.equal(k.labourBreakdown[0].fixed, false); assert.equal(k.labourEstimated, true);
    });
    await check("updateCosting sets labour, adds a cleaner to a finished job, materials and expenses in one go", async () => {
      await act("jobs.updateCosting", { jobId: cj.id, materialCostCents: 1500,
        labour: [{ staffId: cw.id, labourCents: 8000 }, { staffId: cw2.id, labourCents: 3000 }],
        addExpenses: [{ amountCents: 1200, categoryName: "Transport", vendor: "Grab" }, { amountCents: 700, categoryName: "Supplies", staffId: cw2.id }] });
      const k = await act("jobs.costing", { jobId: cj.id });
      assert.equal(k.labourCents, 11000); assert.equal(k.materialCents, 1500); assert.equal(k.otherExpenseCents, 1900);
      assert.equal(k.profitCents, 10000 - 11000 - 1500 - 1900);
      assert.equal(k.labourBreakdown.find((b: any) => b.staffId === cw.id).fixed, true);
      assert.equal(k.labourBreakdown.find((b: any) => b.staffId === cw.id).calculatedCents, 2000);
      const paidByCleaner = k.expenses.find((e: any) => e.staffId === cw2.id);
      assert.equal(paidByCleaner.reimbursable, true);
      // A job expense is an ordinary expense: it shows in the Expenses list, dated on the job.
      const listed = await act("expenses.list", { jobId: cj.id });
      assert.equal(listed.length, 2); assert.equal(new Date(listed[0].spentAt).toISOString(), "2031-06-02T02:00:00.000Z");
    });
    await check("payroll pays exactly the labour set on the job", async () => {
      const p = await act("payroll.calculate", { from: "2031-06-01", to: "2031-06-30" });
      const a = p.lines.find((l: any) => l.staffId === cw.id), b2 = p.lines.find((l: any) => l.staffId === cw2.id);
      assert.equal(a.earnedCents, 8000); assert.equal(a.fixedJobs, 1);
      assert.equal(b2.earnedCents, 3000); assert.equal(b2.reimbursementsCents, 700);
    });
    await check("reports deduct the same labour plus materials", async () => {
      const r = await act("reports.summary", { from: "2031-06-01", to: "2031-06-30" });
      assert.equal(r.labourCents, 11000); assert.equal(r.materialCents, 1500);
      assert.equal(r.profitCents, r.salesCents - r.expenseCents - 11000 - 1500);
      assert.equal(r.totalCostCents, r.expenseCents + 11000 + 1500);
    });
    await check("saving the cleaner list or moving the job keeps labour amounts", async () => {
      await act("jobs.assignStaff", { jobId: cj.id, staffIds: [cw2.id, cw.id] });
      const rows = await client.jobAssignment.findMany({ where: { jobId: cj.id } });
      assert.equal(rows.find((r: any) => r.staffId === cw.id).labourCents, 8000);
      assert.equal(rows.find((r: any) => r.staffId === cw2.id).isLead, true);
    });
    await check("labour can go back to the pay rate, and expenses can be edited and removed", async () => {
      const k0 = await act("jobs.costing", { jobId: cj.id });
      const grab = k0.expenses.find((e: any) => e.vendor === "Grab");
      const supplies = k0.expenses.find((e: any) => e.staffId === cw2.id);
      await act("jobs.updateCosting", { jobId: cj.id, labour: [{ staffId: cw.id, labourCents: null }],
        updateExpenses: [{ expenseId: grab.id, amountCents: 1500 }], removeExpenseIds: [supplies.id] });
      const k = await act("jobs.costing", { jobId: cj.id });
      assert.equal(k.labourBreakdown.find((b: any) => b.staffId === cw.id).costCents, 2000);
      assert.equal(k.otherExpenseCents, 1500); assert.equal(k.expenses.length, 1);
    });
    await check("the costing editor cannot touch another job's expense", async () => {
      await assert.rejects(act("jobs.updateCosting", { jobId: cj.id, removeExpenseIds: [strayExpense.id] }), /not linked/);
      await assert.rejects(act("jobs.updateCosting", { jobId: cj.id, updateExpenses: [{ expenseId: strayExpense.id, amountCents: 1 }] }), /not linked/);
      assert.ok(await client.expense.findUnique({ where: { id: strayExpense.id } }));
    });
    await check("a cleaner cannot change a job's costs", async () => {
      const a = getAction("jobs.update")!;
      await assert.rejects(a.handler(a.input.parse({ jobId: cj.id, materialCostCents: 0 }), { ...ctx, user: { ...ctx.user, role: "STAFF" } }) as any, /owner or admin/);
    });

    /* ---- Notifications: read and dismissed are per person ---- */
    const { listNotifications, setReceipts } = await import("../src/lib/notify");
    const u1 = await client.user.create({ data: { email: "n1@test", name: "N1", password: "x", role: "OWNER" } });
    const u2 = await client.user.create({ data: { email: "n2@test", name: "N2", password: "x", role: "ADMIN" } });
    await client.notification.deleteMany();
    const n1 = await client.notification.create({ data: { type: "INVOICE", title: "One" } });
    await client.notification.create({ data: { type: "INVOICE", title: "Two" } });
    await client.notification.create({ data: { type: "INVOICE", title: "Old", createdAt: new Date(Date.now() - 40 * 86400000) } });
    await check("notifications older than the window drop off, and all start unread", async () => {
      const l = await listNotifications(u1.id);
      assert.equal(l.items.length, 2); assert.equal(l.unread, 2);
    });
    await check("marking all read clears one person's badge only", async () => {
      await setReceipts(u1.id, { read: true });
      assert.equal((await listNotifications(u1.id)).unread, 0);
      assert.equal((await listNotifications(u2.id)).unread, 2);
      await setReceipts(u1.id, { read: true }); // again, over existing receipts
      assert.equal((await listNotifications(u1.id)).items.length, 2);
    });
    await check("dismissing hides it for that person only; clear all empties their bell", async () => {
      await setReceipts(u2.id, { dismissed: true }, n1.id);
      const l2 = await listNotifications(u2.id);
      assert.equal(l2.items.length, 1); assert.equal(l2.unread, 1);
      assert.equal((await listNotifications(u1.id)).items.length, 2);
      await setReceipts(u1.id, { dismissed: true });
      assert.equal((await listNotifications(u1.id)).items.length, 0);
      assert.equal((await listNotifications(u2.id)).items.length, 1);
      assert.equal(await setReceipts(u1.id, { dismissed: true }, "missing-id"), 0);
    });
    await check("re-saving an unchanged team does not notify again", async () => {
      const before = await client.notification.count();
      await act("jobs.assignStaff", { jobId: cj.id, staffIds: [cw2.id, cw.id] });
      assert.equal(await client.notification.count(), before);
    });

    /* ---- Assistant history ---- */
    const chat = await import("../src/lib/chat");
    await check("context window never starts mid tool-call", () => {
      const rows = [{ role: "tool" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }];
      assert.deepEqual(chat.contextWindow(rows).map((r) => r.role), ["user", "assistant"]);
      assert.equal(chat.contextWindow([{ role: "tool" }]).length, 0);
    });
    await check("stored turns replay as bubbles with action badges", () => {
      const calls = JSON.stringify([{ id: "c1", function: { name: "customers_search" } }, { id: "c2", function: { name: "bookings_cancel" } }]);
      const out = chat.toDisplay([
        { role: "user", content: "find Tan", toolCalls: null },
        { role: "assistant", content: "", toolCalls: calls },
        { role: "tool", content: '{"ok":true,"result":[]}', toolCalls: "c1" },
        { role: "tool", content: chat.PENDING, toolCalls: "c2" },
        { role: "assistant", content: "No Tan found.", toolCalls: null },
        { role: "user", content: "ok", toolCalls: null },
      ], (n) => n.replace("_", "."));
      assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "user"]);
      assert.deepEqual(out[1].actions, [{ name: "customers.search", ok: true }]);
      assert.equal(chat.titleFrom("  hello\n world  "), "hello world");
      assert.ok(chat.titleFrom("x".repeat(100)).length <= 60);
    });

    console.log(`${passed} integration checks passed. SQLite isolation does not validate PostgreSQL concurrency behavior.`);
  } finally { await client.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
