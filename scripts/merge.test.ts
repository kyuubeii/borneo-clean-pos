/**
 * Combining invoices, against a disposable SQLite copy of the schema. Never
 * imports the live client. Run through `npm run test:polish`.
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
  const { getAction, runAction } = await import("../src/lib/registry");
  await import("../src/lib/actions");

  const owner: any = { user: { id: "o", role: "OWNER", name: "Owner" }, source: "ui" };
  const run = async (name: string, input: any) => { const a = getAction(name)!; return await a.handler(a.input.parse(input), owner) as any; };

  const sim = await client.customer.create({ data: { name: "Merge Sim" } });
  const other = await client.customer.create({ data: { name: "Merge Other" } });
  let n = 0;
  /** A finished visit on its own invoice, as the app raises them. */
  const visit = async (day: string, customerId = sim.id, paid = 0) => {
    const inv = await client.invoice.create({ data: { ref: `MT-I${++n}`, customerId, status: paid ? "PAID" : "SENT",
      issuedAt: new Date(`${day}T06:00:00Z`), items: { create: [{ name: "House Cleaning", qty: 1, priceCents: 7000 }] } } });
    await client.job.create({ data: { ref: `MT-J${n}`, customerId, invoiceId: inv.id, status: "COMPLETED",
      scheduledAt: new Date(`${day}T01:00:00Z`), revenueCents: 7000 } });
    if (paid) await client.payment.create({ data: { ref: `MT-P${n}`, invoiceId: inv.id, customerId, amountCents: paid,
      paidAt: new Date(`${day}T08:00:00Z`) } });
    return inv;
  };
  const month = (from: string, to: string) => run("reports.summary", { from, to });
  const money = (s: any) => ({ sales: s.salesCents, collected: s.revenueCollectedCents, owing: s.outstandingCents });

  let passed = 0;
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }

  const aug = await visit("2026-08-27", sim.id, 7000);
  const sep1 = await visit("2026-09-03");
  const sep2 = await visit("2026-09-10");
  const theirs = await visit("2026-09-12", other.id);

  const before = { aug: money(await month("2026-08-01", "2026-08-31")), sep: money(await month("2026-09-01", "2026-09-30")) };
  let merged: any;

  await check("the assistant has to ask before combining", async () => {
    const r: any = await runAction("invoices.merge", { invoices: [sep1.ref, sep2.ref] }, { ...owner, source: "assistant" });
    assert.equal(r.code, "NEEDS_CONFIRM");
    assert.equal((await client.invoice.findUnique({ where: { id: sep1.id } })).status, "SENT");
  });

  await check("refuses another customer's invoice, a repeat, or a single invoice", async () => {
    await assert.rejects(run("invoices.merge", { invoices: [sep1.ref, theirs.ref] }), /one customer/);
    await assert.rejects(run("invoices.merge", { invoices: [sep1.ref, sep1.ref] }), /twice/);
    await assert.rejects(run("invoices.merge", { invoices: [sep1.ref, "INV-9999"] }), /No invoice found for INV-9999/);
  });

  await check("combines by ref or id: lines, jobs and payments move, old ones are voided", async () => {
    merged = await run("invoices.merge", { invoices: [sep2.ref, aug.id, sep1.ref.toLowerCase()] });
    assert.deepEqual(merged.combined, [aug.ref, sep1.ref, sep2.ref]);
    assert.equal(merged.totalCents, 21000);
    assert.equal(merged.paidCents, 7000);
    assert.equal(merged.balanceCents, 14000);
    assert.equal(merged.status, "PARTIAL");
    assert.equal(merged.lines, 1);
    const inv = await client.invoice.findUnique({ where: { id: merged.invoiceId }, include: { items: true, jobs: true, payments: true } });
    // One A4 page: the same service at the same price is one line, naming its visits.
    assert.deepEqual(inv.items.map((i: any) => [i.name, i.qty, i.priceCents]), [["House Cleaning — 27 Aug, 3, 10 Sep 2026", 3, 7000]]);
    assert.equal(inv.jobs.length, 3);
    assert.equal(inv.payments.length, 1);
    assert.equal(inv.payments[0].paidAt.toISOString(), "2026-08-27T08:00:00.000Z");
    assert.match(inv.notes, new RegExp(`Combines ${aug.ref}, ${sep1.ref}, ${sep2.ref}`));
    for (const old of [aug, sep1, sep2]) {
      const o = await client.invoice.findUnique({ where: { id: old.id }, include: { payments: true, jobs: true } });
      assert.equal(o.status, "VOID");
      assert.equal(o.payments.length + o.jobs.length, 0);
      assert.match(o.notes, new RegExp(`Combined into ${merged.ref}`));
    }
  });

  await check("no month's sales, collections or owing change", async () => {
    assert.deepEqual(money(await month("2026-08-01", "2026-08-31")), before.aug);
    assert.deepEqual(money(await month("2026-09-01", "2026-09-30")), before.sep);
    assert.equal(before.aug.owing, 0);
    assert.equal(before.sep.owing, 14000 + 7000);
  });

  await check("a payment on the combined invoice clears the oldest visit first", async () => {
    await run("payments.record", { invoiceId: merged.invoiceId, amountCents: 7000, paidAt: "2026-10-02T10:00:00+08:00" });
    const sep = await month("2026-09-01", "2026-09-30");
    assert.equal(sep.outstandingCents, 7000 + 7000);
  });

  await check("visit days read compactly across months and years", async () => {
    const { visitDays } = await import("../src/lib/actions/finance");
    const d = (s: string) => new Date(`${s}T02:00:00Z`);
    assert.equal(visitDays([d("2026-09-03")]), "3 Sep 2026");
    assert.equal(visitDays([d("2026-10-01"), d("2026-09-08"), d("2026-09-03"), d("2026-09-03")]), "3, 8 Sep, 1 Oct 2026");
    assert.equal(visitDays([d("2026-12-28"), d("2027-01-04")]), "28 Dec 2026, 4 Jan 2027");
    // 7:30 am in Kuching is still the previous day in UTC.
    assert.equal(visitDays([new Date("2026-09-02T23:30:00Z")]), "3 Sep 2026");
  });

  await check("a void invoice cannot be combined", async () => {
    const x = await visit("2026-09-20");
    await assert.rejects(run("invoices.merge", { invoices: [x.ref, sep1.ref] }), /void/);
  });

  await check("refs number each prefix on its own (PO- next to RMB- payouts)", async () => {
    const { nextRef } = await import("../src/lib/ref");
    const st = await client.staff.create({ data: { name: "Ref Test" } });
    const at = new Date("2026-09-01T00:00:00Z");
    for (const ref of ["PO-0002", "RMB-0009"]) await client.payout.create({ data: { ref, staffId: st.id, amountCents: 100, periodStart: at, periodEnd: at } });
    assert.equal(await nextRef("PO", "payout", client), "PO-0003");
  });

  console.log(`\n${passed} merge checks passed.`);
  await client.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
