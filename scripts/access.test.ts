/**
 * What a cleaner may do, and the money guards, against a disposable SQLite
 * copy of the schema. Never imports the live client. Run through `npm run test:polish`.
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

  const c = await client.customer.create({ data: { name: "Access Test" } });
  const amy = await client.staff.create({ data: { name: "Amy", payType: "HOURLY", payRate: 1500, phone: "0123" } });
  const ben = await client.staff.create({ data: { name: "Ben", payType: "HOURLY", payRate: 2500, phone: "0456" } });
  const owner: any = { user: { id: "o", role: "OWNER", name: "Owner" }, source: "ui" };
  const asAmy: any = { user: { id: "a", role: "STAFF", name: "Amy", staffId: amy.id }, source: "ui" };
  const run = async (name: string, input: any, ctx: any) => { const a = getAction(name)!; return await a.handler(a.input.parse(input), ctx) as any; };

  let n = 0;
  const job = async (staffId: string, extra: any = {}) => {
    const j = await client.job.create({ data: { ref: `AT-J${++n}`, customerId: c.id, scheduledAt: new Date("2026-10-06T02:00:00Z"), revenueCents: 10000, ...extra } });
    await client.jobAssignment.create({ data: { jobId: j.id, staffId, isLead: true } });
    return j;
  };
  const mine = await job(amy.id), bens = await job(ben.id);
  const item = await client.checklistItem.create({ data: { jobId: bens.id, label: "Windows" } });

  let passed = 0;
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
  const refused = (p: Promise<any>, re: RegExp) => assert.rejects(p, re);

  await check("a cleaner moves their own job along", async () => {
    await run("jobs.updateStatus", { jobId: mine.id, status: "EN_ROUTE" }, asAmy);
    assert.equal((await client.job.findUnique({ where: { id: mine.id } })).status, "EN_ROUTE");
  });
  await check("but cannot touch someone else's job", async () => {
    await refused(run("jobs.updateStatus", { jobId: bens.id, status: "COMPLETED" }, asAmy), /assigned to/);
    await refused(run("jobs.update", { jobId: bens.id, staffNotes: "x" }, asAmy), /assigned to/);
    await refused(run("jobs.setChecklist", { jobId: bens.id, items: [] }, asAmy), /assigned to/);
    await refused(run("jobs.addChecklistItem", { jobId: bens.id, label: "x" }, asAmy), /assigned to/);
    await refused(run("jobs.toggleChecklistItem", { itemId: item.id, done: true }, asAmy), /assigned to/);
    await refused(run("jobs.get", { jobId: bens.id }, asAmy), /not assigned/);
  });
  await check("and cannot cancel, even their own -- cancelling voids the invoice", async () => {
    await refused(run("jobs.updateStatus", { jobId: mine.id, status: "CANCELLED" }, asAmy), /office/);
    await refused(run("jobs.update", { jobId: mine.id, durationMin: 600 }, asAmy), /office/);
  });
  await check("a cleaner checks in only as themselves, and not to a closed job", async () => {
    await refused(run("staff.checkIn", { jobId: mine.id, staffId: ben.id }, asAmy), /yourself/);
    await refused(run("staff.workHistory", { staffId: ben.id }, asAmy), /yourself/);
    await run("staff.checkIn", { jobId: mine.id, staffId: amy.id }, asAmy);
    const done = await job(amy.id, { status: "COMPLETED" });
    await refused(run("staff.checkIn", { jobId: done.id, staffId: amy.id }, owner), /closed/);
  });
  await check("colleagues' pay and contact details are hidden from a cleaner", async () => {
    const rows = await run("staff.list", {}, asAmy);
    const b = rows.find((r: any) => r.id === ben.id), a = rows.find((r: any) => r.id === amy.id);
    assert.equal(b.name, "Ben"); assert.equal(b.payRate, undefined); assert.equal(b.phone, undefined);
    assert.equal(a.payRate, 1500);
    const j = await run("jobs.get", { jobId: mine.id }, asAmy);
    assert.equal(j.assignments[0].staff.payRate, undefined);
    assert.equal((await run("staff.list", {}, owner)).find((r: any) => r.id === ben.id).payRate, 2500);
  });

  const invoice = async (status = "SENT", jobId?: string) => {
    const inv = await client.invoice.create({ data: { ref: `AT-I${++n}`, customerId: c.id, status, items: { create: [{ name: "Clean", qty: 1, priceCents: 10000 }] } } });
    if (jobId) await client.job.update({ where: { id: jobId }, data: { invoiceId: inv.id } });
    return inv;
  };
  await check("no payment on a void invoice", async () => {
    const inv = await invoice("VOID");
    await refused(run("payments.record", { invoiceId: inv.id, amountCents: 1000 }, owner), /void/);
  });
  await check("a refund cannot exceed what was paid", async () => {
    const inv = await invoice();
    await run("payments.record", { invoiceId: inv.id, amountCents: 3000 }, owner);
    await refused(run("payments.refund", { invoiceId: inv.id, amountCents: 3001 }, owner), /cannot be more/);
    await run("payments.refund", { invoiceId: inv.id, amountCents: 3000 }, owner);
  });
  await check("editing a one-job invoice carries the new total to the job's sales", async () => {
    const j = await job(amy.id);
    const inv = await invoice("SENT", j.id);
    await run("invoices.update", { invoiceId: inv.id, items: [{ name: "Clean", qty: 1, priceCents: 15000 }] }, owner);
    assert.equal((await client.job.findUnique({ where: { id: j.id } })).revenueCents, 15000);
    const two = await job(amy.id); await client.job.update({ where: { id: two.id }, data: { invoiceId: inv.id } });
    await refused(run("invoices.update", { invoiceId: inv.id, discountCents: 500 }, owner), /2 jobs/);
  });
  await check("owing is what is unpaid on the period's finished work, plus work never invoiced", async () => {
    await client.job.deleteMany({ where: { customerId: c.id, scheduledAt: { gte: new Date("2026-11-01"), lt: new Date("2026-12-01") } } });
    const at = (d: string, extra: any = {}) => client.job.create({ data: { ref: `AT-J${++n}`, customerId: c.id, scheduledAt: new Date(d), revenueCents: 7000, status: "COMPLETED", ...extra } });
    const paid = await at("2026-11-03T02:00:00Z"), unpaid = await at("2026-11-04T02:00:00Z");
    await at("2026-11-05T02:00:00Z");                                   // never invoiced
    await at("2026-11-06T02:00:00Z", { status: "SCHEDULED" });          // not done yet
    const i1 = await invoice("SENT", paid.id), i2 = await invoice("SENT", unpaid.id);
    await client.invoiceItem.updateMany({ where: { invoiceId: { in: [i1.id, i2.id] } }, data: { priceCents: 7000 } });
    await run("payments.record", { invoiceId: i1.id, amountCents: 7000 }, owner);
    const s = await run("reports.summary", { from: "2026-11-01", to: "2026-11-30" }, owner);
    assert.equal(s.unbilledCents, 7000);
    assert.equal(s.outstandingCents, 14000);
  });

  await client.$disconnect();
  console.log(`\n${passed} access and money checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
