/**
 * The real assistant model, driving the app's actions against a disposable
 * SQLite copy of the schema. Each request is checked by what it changed in the
 * database, not by what the model says. Never imports the live client.
 *
 * Uses OpenRouter credit (roughly US$2-3 a run), so it is not part of
 * test:polish. Run it with `npm run eval:ai`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/** Only the assistant's key and model are read from .env; nothing that names a database. */
function openRouterEnv() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^(OPENROUTER_API_KEY|OPENROUTER_MODEL)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}

async function main() {
  const path = process.env.POLISH_TEST_CLIENT;
  if (!path || !path.includes("borneo-polish-test")) throw new Error("Use npm run eval:ai; an isolated client is required.");
  const { PrismaClient } = require(path);
  // SQLite has no `mode: "insensitive"` (its LIKE already ignores case), so the
  // option the live Postgres queries use is dropped here rather than in the app.
  const strip = (v: any): any => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" && !(v instanceof Date)
    ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !(k === "mode" && x === "insensitive")).map(([k, x]) => [k, strip(x)])) : v;
  const db = new PrismaClient().$extends({ query: { $allModels: { $allOperations: ({ args, query }: any) => query(strip(args)) } } });
  (globalThis as any).prisma = db;
  for (const k of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY", "DATABASE_URL", "DIRECT_URL"]) delete process.env[k];
  const file = openRouterEnv();
  const key = process.env.OPENROUTER_API_KEY || file.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || file.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
  if (!key) throw new Error("Set OPENROUTER_API_KEY (the key saved under Settings → AI Assistant).");

  const { runAction, toolSchemas, resolveAction } = await import("../src/lib/registry");
  await import("../src/lib/actions");
  const { chatCompletion } = await import("../src/lib/openrouter");
  const { systemPrompt } = await import("../src/lib/chat");

  /* ---------------------------------- Seed ---------------------------------- */
  const user: any = { id: "owner", name: "Oscar", role: "OWNER" };
  await db.user.create({ data: { id: "owner", email: "owner@test.local", name: "Oscar", role: "OWNER", password: "x" } });
  const service = await db.service.create({ data: { name: "House Cleaning", priceCents: 7000, durationMin: 120 } });
  const jong = await db.staff.create({ data: { name: "Jong", payType: "PER_JOB", payRate: 3000 } });
  await db.expenseCategory.create({ data: { name: "Fuel" } });
  await db.expenseCategory.create({ data: { name: "Supplies" } });
  const sim = await db.customer.create({ data: { name: "Beautrix Sim 507", phone: "0111111111", addresses: { create: [{ line1: "507 Jalan Test", city: "Kuching", isPrimary: true }] } } });
  const shirley = await db.customer.create({ data: { name: "Shirley Bong", phone: "0122222222", addresses: { create: [{ line1: "12 Jalan Shirley", city: "Kuching", isPrimary: true }] } } });
  let n = 0;
  const pad = (k: number) => String(k).padStart(4, "0");
  for (const day of ["2026-09-03", "2026-09-08", "2026-09-10"]) {
    n++;
    const inv = await db.invoice.create({ data: { ref: `INV-${pad(n)}`, customerId: sim.id, status: "SENT",
      issuedAt: new Date(`${day}T06:00:00Z`), items: { create: [{ name: "House Cleaning", qty: 1, priceCents: 7000 }] } } });
    await db.job.create({ data: { ref: `JOB-${pad(n)}`, customerId: sim.id, invoiceId: inv.id, status: "COMPLETED",
      scheduledAt: new Date(`${day}T01:00:00Z`), revenueCents: 7000 } });
  }
  const sep3 = await db.job.findFirst({ where: { ref: "JOB-0001" } });
  await db.jobAssignment.create({ data: { jobId: sep3.id, staffId: jong.id, isLead: true, labourCents: 3000 } });
  await db.payout.create({ data: { ref: "RMB-0001", kind: "REIMBURSEMENT", staffId: jong.id, amountCents: 4500, status: "PAID",
    periodStart: new Date("2026-08-04"), periodEnd: new Date("2026-08-04"), paidAt: new Date("2026-08-04"), note: "Petrol advanced by Jong" } });

  /* ------------------------------ The tool loop ----------------------------- */
  // The same loop as /api/ai/chat, with the person pressing Confirm on every prompt.
  const tools = toolSchemas(user);
  async function ask(prompt: string) {
    const messages: any[] = [{ role: "system", content: systemPrompt(user, "Borneo Clean Services", new Date("2026-10-02T03:00:00Z")) },
      { role: "user", content: prompt }];
    const called: string[] = [];
    for (let step = 0; step < 10; step++) {
      const reply = await chatCompletion({ messages, tools, model, apiKey: key });
      if (!reply.tool_calls?.length) return { text: reply.content ?? "", called };
      messages.push(reply);
      for (const call of reply.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        const name = resolveAction(call.function.name)?.name ?? call.function.name;
        let res: any = await runAction(name, args, { user, source: "assistant" });
        if (!res.ok && res.needsConfirm) res = await runAction(name, res.input, { user, source: "assistant" }, { confirmed: true });
        called.push(`${name}${res.ok ? "" : " ✗"}`);
        messages.push({ role: "tool", tool_call_id: call.id,
          content: JSON.stringify(res.ok ? { ok: true, result: res.data } : { ok: false, error: res.error }).slice(0, 12000) });
      }
    }
    return { text: "(ran out of steps)", called };
  }

  let passed = 0, failed = 0;
  async function check(prompt: string, verify: (r: { text: string; called: string[] }) => Promise<void> | void) {
    const r = await ask(prompt);
    try {
      await verify(r); passed++;
      console.log(`PASS  ${prompt}\n      ${r.called.join(" → ") || "(no tools)"}`);
    } catch (e: any) {
      failed++;
      console.log(`FAIL  ${prompt}\n      ${r.called.join(" → ") || "(no tools)"}\n      ${e.message.split("\n")[0]}\n      reply: ${r.text.slice(0, 300).replace(/\n/g, " ")}`);
    }
  }
  const kuching = (d: Date) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

  /* -------------------------------- Requests -------------------------------- */
  await check("Combine all of Beautrix Sim's unpaid invoices into one invoice", async () => {
    const merged = await db.invoice.findFirst({ where: { notes: { contains: "Combines" } }, include: { items: true, jobs: true } });
    assert.ok(merged, "no combined invoice");
    assert.equal(merged.jobs.length, 3);
    assert.equal(await db.invoice.count({ where: { customerId: sim.id, status: "VOID" } }), 3);
  });

  await check("Ms Sim paid RM 140 by bank transfer today against her combined invoice", async () => {
    const p = await db.payment.findFirst({ where: { customerId: sim.id }, include: { invoice: true } });
    assert.ok(p, "no payment");
    assert.equal(p.amountCents, 14000);
    assert.equal(p.method, "BANK");
    assert.match(p.invoice.notes ?? "", /Combines/);
    assert.equal(p.invoice.status, "PARTIAL");
  });

  await check("Book Shirley Bong for house cleaning next Monday at 10am", async () => {
    const b = await db.booking.findFirst({ where: { customerId: shirley.id }, include: { job: true } });
    assert.ok(b, "no booking");
    assert.equal(kuching(b.startAt), "2026-10-05 10:00");
    assert.ok(b.job, "booking has no job");
  });

  await check("Assign Jong to Shirley's job on Monday", async () => {
    const a = await db.jobAssignment.findFirst({ where: { staffId: jong.id, job: { customerId: shirley.id } } });
    assert.ok(a, "Jong not assigned");
  });

  await check("Record RM 25 petrol today, Jong paid for it himself", async () => {
    const e = await db.expense.findFirst({ where: { amountCents: 2500 }, include: { category: true } });
    assert.ok(e, "no expense");
    assert.equal(e.category?.name, "Fuel");
    assert.equal(await db.expenseCategory.count(), 2, "started a new category");
    assert.equal(e.staffId, jong.id);
    assert.equal(e.reimbursable, true);
  });

  await check("Who still owes us money, and how much?", (r) => {
    assert.ok(r.called.some((c) => /payments\.outstanding|invoices\.list/.test(c)), "did not check balances");
    assert.match(r.text, /70/);
  });

  await check("What is RMB-0001?", (r) => {
    assert.ok(r.called.includes("lookup.byRef"), "did not look it up");
    assert.match(r.text, /45/);
  });

  await check("How much did we make in September? Sales, collected and profit.", (r) => {
    assert.ok(r.called.includes("reports.summary"));
    assert.match(r.text, /210/);
  });

  await check("Add a new customer Tan Ah Kow, phone 0123456789, at 8 Jalan Song, Kuching", async () => {
    const c = await db.customer.findFirst({ where: { name: { contains: "Tan Ah Kow" } }, include: { addresses: true } });
    assert.ok(c, "no customer");
    assert.equal(c.phone?.replace(/\D/g, ""), "0123456789");
    assert.ok(c.addresses.length, "no address");
  });

  await check("Set booking reminders to 1 day and 3 days before", async () => {
    const s = await db.setting.findUnique({ where: { key: "reminders.days" } });
    assert.equal(s?.value, "1,3");
  });

  await check("Cancel Shirley's booking on Monday, she called to cancel", async () => {
    const j = await db.job.findFirst({ where: { customerId: shirley.id } });
    assert.equal(j.status, "CANCELLED");
  });

  await check("这个月有几个工作？", (r) => {
    assert.match(r.text, /[一-鿿]/, "did not answer in Chinese");
  });

  /* ------------------------- Quote to cash, and back ------------------------ */
  const tan = () => db.customer.findFirst({ where: { name: { contains: "Tan Ah Kow" } } });

  await check("Make a quotation for Tan Ah Kow: deep cleaning RM 350, valid 14 days", async () => {
    const q = await db.quote.findFirst({ where: { customerId: (await tan()).id }, include: { items: true } });
    assert.ok(q, "no quote");
    assert.equal(q.items.reduce((a: number, i: any) => a + i.qty * i.priceCents, 0), 35000);
  });

  await check("Tan accepted the quote. Book it for 7 Oct at 9am", async () => {
    const b = await db.booking.findFirst({ where: { customerId: (await tan()).id }, include: { job: true } });
    assert.ok(b, "no booking");
    assert.equal(kuching(b.startAt), "2026-10-07 09:00");
    assert.equal(b.job?.revenueCents, 35000);
  });

  await check("Tan's deep cleaning is done, mark the job completed and invoice it", async () => {
    const j = await db.job.findFirst({ where: { customerId: (await tan()).id }, include: { invoice: { include: { items: true } } } });
    assert.equal(j.status, "COMPLETED");
    assert.ok(j.invoice, "not invoiced");
  });

  await check("Tan paid the invoice in full, cash", async () => {
    const j = await db.job.findFirst({ where: { customerId: (await tan()).id }, include: { invoice: true } });
    assert.equal(j.invoice.status, "PAID");
  });

  await check("Refund Tan RM 50, we missed one room", async () => {
    const r = await db.payment.findFirst({ where: { isRefund: true } });
    assert.ok(r, "no refund");
    assert.equal(r.amountCents, 5000);
  });

  await check("We have paid Jong back for the RM 25 petrol", async () => {
    const e = await db.expense.findFirst({ where: { amountCents: 2500 } });
    assert.equal(e.reimbursed, true);
  });

  await check("How much do we owe Jong for September? Pay him for it.", async () => {
    const p = await db.payout.findFirst({ where: { staffId: jong.id, kind: "EARNINGS" } });
    assert.ok(p, "no payout");
    assert.equal(p.amountCents, 3000);
    assert.match(p.ref, /^PO-\d{4}$/);
  });

  await check("Add a service: Window Cleaning, RM 80, takes an hour and a half", async () => {
    const sv = await db.service.findFirst({ where: { name: { contains: "Window" } } });
    assert.ok(sv, "no service");
    assert.equal(sv.priceCents, 8000);
    assert.equal(sv.durationMin, 90);
  });

  await check("Shirley's new phone number is 019-999 9999", async () => {
    const c = await db.customer.findUnique({ where: { id: shirley.id } });
    assert.equal(c.phone?.replace(/\D/g, ""), "0199999999");
  });

  await check("Who are our top customers this year?", (r) => {
    assert.ok(r.called.some((c) => /reports\.topCustomers/.test(c)), "did not use the report");
    assert.match(r.text, /Tan|Sim/);
  });

  await check("Show this month's expenses by category", (r) => {
    assert.ok(r.called.some((c) => /reports\.expenseBreakdown|expenses\.list/.test(c)));
    assert.match(r.text, /Fuel/);
  });

  console.log(`\n${passed} passed, ${failed} failed (${model}).`);
  await db.$disconnect();
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
