/**
 * What cancelling a job does to the money, against a disposable SQLite copy of
 * the schema. Never imports the live client. Run through `npm run test:polish`.
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

  const { setJobStatus } = await import("../src/lib/scheduling");
  const { countedExpense } = await import("../src/lib/actions/reports");

  let passed = 0;
  async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }

  const c = await client.customer.create({ data: { name: "Cancel Test" } });
  let n = 0;
  const job = (invoiceId?: string) => client.job.create({ data: {
    ref: `CT-J${++n}`, customerId: c.id, scheduledAt: new Date("2026-10-05T02:00:00Z"), revenueCents: 10000, ...(invoiceId ? { invoiceId } : {}),
  } });
  const invoice = (status = "SENT") => client.invoice.create({ data: {
    ref: `CT-I${++n}`, customerId: c.id, status, items: { create: [{ name: "Cleaning", qty: 1, priceCents: 10000 }] },
  } });
  const statusOf = async (id: string) => (await client.invoice.findUnique({ where: { id } })).status;

  await check("cancelling a job voids its unpaid invoice", async () => {
    const inv = await invoice();
    const j = await job(inv.id);
    await setJobStatus(client, j.id, "CANCELLED");
    assert.equal(await statusOf(inv.id), "VOID");
    assert.ok(await client.notification.findFirst({ where: { title: `Invoice ${inv.ref} voided` } }));
  });

  await check("an invoice with money paid on it is left alone, and flagged", async () => {
    const inv = await invoice("PARTIAL");
    await client.payment.create({ data: { ref: `CT-P${++n}`, invoiceId: inv.id, customerId: c.id, amountCents: 3000 } });
    const j = await job(inv.id);
    await setJobStatus(client, j.id, "CANCELLED");
    assert.equal(await statusOf(inv.id), "PARTIAL");
    assert.ok(await client.notification.findFirst({ where: { title: `Invoice ${inv.ref} needs checking` } }));
  });

  await check("a deposit refunded in full no longer holds the invoice open", async () => {
    const inv = await invoice();
    await client.payment.create({ data: { ref: `CT-P${++n}`, invoiceId: inv.id, customerId: c.id, amountCents: 3000 } });
    await client.payment.create({ data: { ref: `CT-P${++n}`, invoiceId: inv.id, customerId: c.id, amountCents: 3000, isRefund: true } });
    const j = await job(inv.id);
    await setJobStatus(client, j.id, "CANCELLED");
    assert.equal(await statusOf(inv.id), "VOID");
  });

  await check("an invoice that also bills a job still going ahead is not voided", async () => {
    const inv = await invoice();
    const a = await job(inv.id); await job(inv.id);
    await setJobStatus(client, a.id, "CANCELLED");
    assert.equal(await statusOf(inv.id), "SENT");
  });

  await check("expenses on a cancelled job are not counted; others are", async () => {
    const live = await job(), dead = await job();
    await setJobStatus(client, dead.id, "CANCELLED");
    const spentAt = new Date("2026-10-05T03:00:00Z");
    await client.expense.create({ data: { ref: `CT-E${++n}`, amountCents: 100, jobId: live.id, spentAt } });
    await client.expense.create({ data: { ref: `CT-E${++n}`, amountCents: 200, jobId: dead.id, spentAt } });
    await client.expense.create({ data: { ref: `CT-E${++n}`, amountCents: 400, spentAt } });
    const sum = await client.expense.aggregate({ _sum: { amountCents: true }, where: { spentAt, ...countedExpense } });
    assert.equal(sum._sum.amountCents, 500);
  });

  await client.$disconnect();
  console.log(`\n${passed} cancellation checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
