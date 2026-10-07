/**
 * Customer money a worker collects and keeps, against a disposable SQLite copy
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
  const run = async (name: string, input: any) => { const a = getAction(name)!; return await a.handler(a.input.parse(input), owner) as any; };

  const c = await client.customer.create({ data: { name: "Collect Test" } });
  const driver = await client.staff.create({ data: { name: "Driver Test" } });
  const other = await client.staff.create({ data: { name: "Other Test" } });
  let n = 0;
  const invoice = () => client.invoice.create({ data: { ref: `CL-I${++n}`, customerId: c.id, status: "SENT", items: { create: [{ name: "Cleaning", qty: 1, priceCents: 20000 }] } } });
  // The driver paid RM 500 of costs out of pocket.
  await client.expense.create({ data: { ref: `CL-E${++n}`, staffId: driver.id, amountCents: 50000, reimbursable: true } });
  const owed = async (id = driver.id) => (await run("staff.advances", { staffId: id }))[0];

  let passed = 0;
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }

  let pay: any;
  await check("money the driver collected counts against what they are owed", async () => {
    const inv = await invoice();
    pay = await run("payments.record", { invoiceId: inv.id, amountCents: 20000, method: "CASH", receivedById: driver.id });
    assert.equal(pay.collectedBy, "Driver Test");
    const o = await owed();
    assert.equal(o.collectedCents, 20000);
    assert.equal(o.stillOwedCents, 30000);
    assert.equal((await owed(other.id)), undefined);
  });

  await check("money the owner received does not", async () => {
    const inv = await invoice();
    await run("payments.record", { invoiceId: inv.id, amountCents: 20000, method: "BANK" });
    assert.equal((await owed()).stillOwedCents, 30000);
  });

  await check("the collector shows on the invoice and in the payments list", async () => {
    const p = await client.payment.findFirst({ where: { ref: pay.paymentRef } });
    const inv = await run("invoices.get", { invoiceId: p.invoiceId });
    assert.equal(inv.payments[0].receivedBy.name, "Driver Test");
    const list = await run("payments.list", {});
    assert.equal(list.find((x: any) => x.ref === pay.paymentRef).collectedBy, "Driver Test");
  });

  await check("a refund of collected money puts it back", async () => {
    const p = await client.payment.findFirst({ where: { ref: pay.paymentRef } });
    await client.payment.create({ data: { ref: `CL-R${++n}`, invoiceId: p.invoiceId, customerId: c.id, amountCents: 5000, isRefund: true, receivedById: driver.id } });
    assert.equal((await owed()).stillOwedCents, 35000);
  });

  await check("deleting a collected payment puts it back", async () => {
    await client.payment.deleteMany({ where: { receivedById: driver.id } });
    assert.equal((await owed()).stillOwedCents, 50000);
  });

  await check("an unknown collector is refused", async () => {
    const inv = await invoice();
    await assert.rejects(run("payments.record", { invoiceId: inv.id, amountCents: 100, receivedById: "nobody" }), /not found/);
  });

  await check("their pay on completed jobs (driver fees) is owed too, less wages paid", async () => {
    const before = (await owed()).stillOwedCents;
    const j = await client.job.create({ data: { ref: `CL-J${++n}`, customerId: c.id, status: "COMPLETED", scheduledAt: new Date("2026-09-22T02:00:00Z"), revenueCents: 7000 } });
    await client.jobAssignment.create({ data: { jobId: j.id, staffId: driver.id, labourCents: 2000 } });
    const pending = await client.job.create({ data: { ref: `CL-J${++n}`, customerId: c.id, status: "SCHEDULED", scheduledAt: new Date("2026-10-22T02:00:00Z"), revenueCents: 7000 } });
    await client.jobAssignment.create({ data: { jobId: pending.id, staffId: driver.id, labourCents: 2000 } });
    let o = await owed();
    assert.equal(o.earnedCents, 2000);
    assert.equal(o.stillOwedCents, before + 2000);
    const at = new Date("2026-09-30T00:00:00Z");
    await client.payout.create({ data: { ref: `CL-PO${++n}`, kind: "EARNINGS", status: "PAID", staffId: driver.id, amountCents: 1500, periodStart: at, periodEnd: at } });
    o = await owed();
    assert.equal(o.wagesPaidCents, 1500);
    assert.equal(o.stillOwedCents, before + 500);
  });

  console.log(`\n${passed} collection checks passed.`);
  await client.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
