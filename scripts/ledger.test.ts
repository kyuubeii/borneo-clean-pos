/**
 * The month ledger (the spreadsheet layout), against a disposable SQLite copy
 * of the schema. Never imports the live client. Run through `npm run test:polish`.
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
  const { getAction } = await import("../src/lib/registry");
  await import("../src/lib/actions");
  const owner: any = { user: { id: "o", role: "OWNER", name: "Owner" }, source: "ui" };
  const ledger = async (month: string) => { const a = getAction("reports.ledger")!; return await a.handler(a.input.parse({ month }), owner) as any; };

  await client.user.create({ data: { email: "ledger-owner@test.local", name: "Boss", role: "OWNER", password: "x" } }).catch(() => {});
  const c = await client.customer.create({ data: { name: "Ledger Cust" } });
  const w = await client.staff.create({ data: { name: "Ledger Driver" } });
  const drv = await client.expenseCategory.upsert({ where: { name: "Driver" }, update: {}, create: { name: "Driver" } });
  const wrk = await client.expenseCategory.upsert({ where: { name: "Worker" }, update: {}, create: { name: "Worker" } });
  let n = 0;
  const at = (s: string) => new Date(`${s}T08:00:00+08:00`);
  const job = async (day: string, status: string, revenueCents: number, labourCents?: number) => {
    const j = await client.job.create({ data: { ref: `LG-J${++n}`, customerId: c.id, status, scheduledAt: at(day), revenueCents } });
    if (labourCents != null) await client.jobAssignment.create({ data: { jobId: j.id, staffId: w.id, labourCents } });
    return j;
  };
  const invoice = async (j: any, cents: number) => {
    const inv = await client.invoice.create({ data: { ref: `LG-I${++n}`, customerId: c.id, status: "SENT", items: { create: [{ name: "Cleaning", qty: 1, priceCents: cents }] } } });
    await client.job.update({ where: { id: j.id }, data: { invoiceId: inv.id } });
    return inv;
  };
  const pay = (inv: any, cents: number, day: string, extra: any = {}) =>
    client.payment.create({ data: { ref: `LG-P${++n}`, invoiceId: inv.id, customerId: c.id, amountCents: cents, paidAt: at(day), ...extra } });

  // November 2030: two jobs; the owner is paid for one, the driver collects the other.
  const a = await job("2030-11-03", "COMPLETED", 10000, 2000);
  const b = await job("2030-11-10", "COMPLETED", 8000);
  await job("2030-11-20", "SCHEDULED", 9000, 2000);         // not done: no sale, no driver fee
  await pay(await invoice(a, 10000), 10000, "2030-11-04");
  await pay(await invoice(b, 8000), 8000, "2030-11-11", { receivedById: w.id });
  await client.expense.create({ data: { ref: `LG-E${++n}`, staffId: w.id, categoryId: wrk.id, amountCents: 3000, spentAt: at("2030-11-03"), reimbursable: true } });
  await client.expense.create({ data: { ref: `LG-E${++n}`, staffId: w.id, categoryId: drv.id, amountCents: 1000, spentAt: at("2030-11-10"), reimbursable: true } });
  await client.expense.create({ data: { ref: `LG-E${++n}`, categoryId: wrk.id, amountCents: 500, spentAt: at("2030-11-12"), vendor: "Trolley" } });
  // December: an unpaid job, a refund, and the driver paid for November.
  const d = await job("2030-12-02", "COMPLETED", 7000);
  const dInv = await invoice(d, 7000);
  await pay(dInv, 2000, "2030-12-03");
  await pay(dInv, 500, "2030-12-04", { isRefund: true });
  await client.payout.create({ data: { ref: `LG-PO${++n}`, staffId: w.id, kind: "REIMBURSEMENT", status: "PAID", amountCents: 3000, paidAt: at("2030-12-05"), periodStart: at("2030-11-01"), periodEnd: at("2030-11-30") } });

  let passed = 0;
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }

  await check("the owner's month: collected, paid, nothing left unpaid", async () => {
    const o = (await ledger("2030-11")).owner;
    assert.deepEqual(o.totals, { collectedCents: 10000, paidCents: 500, uncollectedCents: 0 });
    assert.equal(o.balanceCents, o.broughtForwardCents + 9500);
    assert.ok(o.rows.every((r: any) => r.date.startsWith("2030-11")));
  });

  await check("the worker's month: expenses, driver fees (expense and on the job), customer money", async () => {
    const wk = (await ledger("2030-11")).workers.find((x: any) => x.name === "Ledger Driver");
    assert.deepEqual(wk.totals, { expenseCents: 3000, driverCents: 3000, fromOwnerCents: 0, fromCustomerCents: 8000 });
    assert.equal(wk.broughtForwardCents, 0);
    assert.equal(wk.owedCents, -2000);  // collected more than they are owed: they hold RM 20 of the business's money
    assert.equal(wk.driverEarnedToDateCents, 3000);
  });

  await check("next month carries both balances forward", async () => {
    const l = await ledger("2030-12");
    const nov = await ledger("2030-11");
    assert.equal(l.owner.broughtForwardCents, nov.owner.balanceCents);
    assert.deepEqual(l.owner.totals, { collectedCents: 1500, paidCents: 3000, uncollectedCents: 5500 });
    const wk = l.workers.find((x: any) => x.name === "Ledger Driver");
    assert.equal(wk.broughtForwardCents, -2000);
    assert.equal(wk.totals.fromOwnerCents, 3000);
    assert.equal(wk.owedCents, -5000);
  });

  await check("a scheduled job adds no sale, no driver fee and nothing to collect", async () => {
    const l = await ledger("2030-11");
    assert.ok(!l.owner.rows.some((r: any) => r.date === "2030-11-20"));
    assert.ok(!l.workers.flatMap((x: any) => x.rows).some((r: any) => r.date === "2030-11-20"));
  });

  await check("months follow the Kuching calendar", async () => {
    // 7:30 am on 1 Dec in Kuching is still 30 Nov in UTC.
    const j = await job("2030-11-28", "COMPLETED", 100);
    await client.job.update({ where: { id: j.id }, data: { scheduledAt: new Date("2030-11-30T23:30:00Z") } });
    assert.ok((await ledger("2030-12")).owner.rows.some((r: any) => r.date === "2030-12-01" && r.uncollectedCents === 100));
  });

  console.log(`\n${passed} ledger checks passed.`);
  await client.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
