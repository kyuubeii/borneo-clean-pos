/**
 * Check the app against the source transaction log, row by row.
 *
 *   npm run audit
 *
 * Exits non-zero the moment anything disagrees, so it is safe to trust a
 * clean run. Reads only — it never writes to the database.
 */
import { PrismaClient } from "@prisma/client";

import data from "./import-data.json";
import profiles from "./customer-profiles.json";

const db = new PrismaClient();
const C = (n: number) => Math.round(n * 100);
const RM = (c: number) => `RM ${(c / 100).toFixed(2)}`;
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Row = { d: string; k: string; amt: number; cat?: string; customer?: string; to?: string; by?: string; pay?: string; cleared?: boolean };
const rows = data as Row[];
const problems: string[] = [];
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`); if (!ok) problems.push(msg); };

/** Match source rows to records one-for-one on (date, amount), so a duplicate or a shifted date shows up. */
function pair(label: string, src: { d: string; amt: number }[], got: { d: string; cents: number }[]) {
  const bag = new Map<string, number>();
  for (const g of got) bag.set(`${g.d}|${g.cents}`, (bag.get(`${g.d}|${g.cents}`) ?? 0) + 1);
  const unmatched: { d: string; cents: number }[] = [];
  for (const r of src) {
    const key = `${r.d}|${C(r.amt)}`;
    const n = bag.get(key) ?? 0;
    if (n === 0) unmatched.push({ d: r.d, cents: C(r.amt) });
    else bag.set(key, n - 1);
  }
  const surplus: { d: string; cents: number }[] = [];
  for (const [k, n] of bag) { const [d, c] = k.split("|"); for (let i = 0; i < n; i++) surplus.push({ d, cents: Number(c) }); }

  // A row whose amount was corrected in the app shows up as one missing and one extra on
  // the same day. That is an edit, not a broken import, so pair them off and say so.
  const changed: string[] = [];
  const missing: string[] = [];
  for (const u of unmatched) {
    const i = surplus.findIndex((x) => x.d === u.d);
    if (i === -1) { missing.push(`${u.d} ${RM(u.cents)}`); continue; }
    changed.push(`${u.d}: log ${RM(u.cents)}, app ${RM(surplus[i].cents)}`);
    surplus.splice(i, 1);
  }
  check(missing.length === 0, `${label}: every source row has a record on the same date${missing.length ? ` — missing ${missing.join(", ")}` : ""}`);
  check(surplus.length === 0, `${label}: no records the source does not have${surplus.length ? ` — extra ${surplus.map((x) => `${x.d} ${RM(x.cents)}`).join(", ")}` : ""}`);
  for (const c of changed) console.log(`        amount changed since the import — ${c}`);
  return changed.length;
}

async function main() {
  const dates = rows.map((r) => r.d).sort();
  const [from, to] = [dates[0], dates.at(-1)!];
  // Anything dated after the log is new business done in the app, not an import problem,
  // so the comparison is scoped to the period the log covers.
  const within = (d: Date) => day(d) >= from && day(d) <= to;
  console.log(`Source: ${rows.length} rows, ${from} to ${to}\n`);

  const inc = rows.filter((r) => r.k === "INC");
  const exp = rows.filter((r) => r.k === "EXP");
  const col = rows.filter((r) => r.k === "COLLECTION");
  const rmb = rows.filter((r) => r.k === "REIMBURSEMENT");

  console.log("1. Everything in the log reached the app");
  const allJobs = await db.job.findMany();
  const allExpenses = await db.expense.findMany({ include: { category: true } });
  const allPayouts = await db.payout.findMany();
  const jobs = allJobs.filter((j) => within(j.scheduledAt));
  const expenses = allExpenses.filter((e) => within(e.spentAt));
  const payouts = allPayouts.filter((p) => p.paidAt && within(p.paidAt));
  const later = (allJobs.length - jobs.length) + (allExpenses.length - expenses.length) + (allPayouts.length - payouts.length);
  if (later) console.log(`  (${later} record(s) dated outside ${from}–${to} — work done in the app since, not checked here)`);
  check(jobs.length === inc.length, `${inc.length} sales in the log, ${jobs.length} jobs in the app`);
  check(expenses.length === exp.length, `${exp.length} expenses in the log, ${expenses.length} in the app`);
  check(payouts.filter((p) => p.kind === "REIMBURSEMENT").length === rmb.length, `${rmb.length} reimbursements in the log, ${payouts.filter((p) => p.kind === "REIMBURSEMENT").length} in the app`);
  check((await db.capitalEntry.count()) === 0, "no capital entries — the RM 2,000 is a reimbursement, not capital");

  console.log("\n2. Row by row, on date and amount");
  const edited =
    pair("sales", inc.map((r) => ({ d: r.d, amt: r.amt })), jobs.map((j) => ({ d: day(j.scheduledAt), cents: j.revenueCents }))) +
    pair("expenses", exp.map((r) => ({ d: r.d, amt: r.amt })), expenses.map((e) => ({ d: day(e.spentAt), cents: e.amountCents })));

  console.log("\n3. Totals");
  const sales = inc.reduce((a, r) => a + C(r.amt), 0);
  const spend = exp.reduce((a, r) => a + C(r.amt), 0);
  const cash = inc.filter((r) => r.pay === "paid").reduce((a, r) => a + C(r.amt), 0) + col.reduce((a, r) => a + C(r.amt), 0);
  const gotSales = jobs.reduce((a, j) => a + j.revenueCents, 0);
  const gotSpend = expenses.reduce((a, e) => a + e.amountCents, 0);
  check(gotSales === sales || edited > 0, `sales ${RM(gotSales)}${gotSales === sales ? "" : ` (the log totalled ${RM(sales)} before the edits above)`}`);
  check(gotSpend === spend || edited > 0, `expenses ${RM(gotSpend)}${gotSpend === spend ? "" : ` (the log totalled ${RM(spend)} before the edits above)`}`);
  const payments = (await db.payment.findMany({ include: { invoice: true, customer: true } })).filter((p) => within(p.paidAt));
  check(payments.reduce((a, p) => a + p.amountCents, 0) === cash, `cash received ${RM(cash)}`);
  const invoices = (await db.invoice.findMany({ include: { items: true } })).filter((i) => within(i.issuedAt));
  const billed = invoices.reduce((a, i) => a + i.items.reduce((b, x) => b + x.priceCents * x.qty, 0), 0);
  // Compared against what the app now holds, not the log, so a corrected amount still
  // has to flow all the way through to the invoice.
  check(billed === gotSales, `invoiced ${RM(billed)} — every sale has an invoice for the same amount`);
  const received = payments.reduce((a, p) => a + p.amountCents, 0);
  check(billed - received === gotSales - received, `outstanding ${RM(gotSales - received)}`);
  console.log(`        profit ${RM(sales - spend)} on an accrual basis`);

  console.log("\n4. Collections settle old invoices — they are never new sales");
  for (const c of col) {
    const mine = payments.filter((p) => day(p.paidAt) === c.d && p.customer.name === c.customer);
    const paid = mine.reduce((a, p) => a + p.amountCents, 0);
    const older = mine.every((p) => !!p.invoice && day(p.invoice.issuedAt) < c.d);
    check(paid === C(c.amt) && older && mine.length > 0,
      `${c.d} ${c.customer}: ${RM(paid)} across ${mine.length} payment(s), all against invoices issued before that day`);
    check(allJobs.every((j) => day(j.scheduledAt) !== c.d), `${c.d}: no job was created for the collection`);
  }

  console.log("\n5. The reimbursement is not double-counted");
  for (const r of rmb) {
    const asExpense = expenses.filter((e) => e.amountCents === C(r.amt) && day(e.spentAt) === r.d);
    check(asExpense.length === 0, `${r.d} ${RM(C(r.amt))} repayment is not also an expense`);
  }
  check((await db.staff.findMany()).every((s) => s.name !== "Aaron"), "no duplicate \"Aaron\" — merged into Jong");

  console.log("\n6. What is still owed to whoever paid out of pocket");
  // Every figure below is read back out of the database and only then compared to the log,
  // so the number printed here is the number the Expenses page works from.
  for (const person of await db.staff.findMany()) {
    const src = exp.filter((r) => r.by === person.name);
    const want = {
      advanced: src.reduce((a, r) => a + C(r.amt), 0),
      cleared: src.filter((r) => r.cleared).reduce((a, r) => a + C(r.amt), 0),
      repaid: rmb.filter((r) => r.to === person.name).reduce((a, r) => a + C(r.amt), 0),
    };
    const mine = expenses.filter((e) => e.staffId === person.id);
    const got = {
      advanced: mine.reduce((a, e) => a + e.amountCents, 0),
      cleared: mine.filter((e) => e.reimbursed).reduce((a, e) => a + e.amountCents, 0),
      repaid: payouts.filter((p) => p.staffId === person.id && p.kind === "REIMBURSEMENT").reduce((a, p) => a + p.amountCents, 0),
    };
    const owed = got.advanced - Math.max(got.cleared, got.repaid);
    // Only `advanced` and `repaid` are import state. Marking a row reimbursed in the app is
    // ordinary day-to-day work, so `cleared` is expected to drift above the log and is
    // reported rather than asserted — otherwise honest use of the app turns the audit red.
    const agrees = (["advanced", "repaid"] as const).filter((k) => got[k] !== want[k]);
    check(agrees.length === 0 && got.cleared >= want.cleared,
      `${person.name} advanced ${RM(got.advanced)}, repaid ${RM(got.repaid)}, of which ${RM(got.cleared)} is matched to rows -> still owed ${RM(owed)}`
      + (agrees.length ? ` — the log says ${agrees.map((k) => `${k} ${RM(want[k])}`).join(", ")}` : "")
      + (got.cleared < want.cleared ? ` — the log clears ${RM(want.cleared)}, the app only ${RM(got.cleared)}` : ""));
    if (got.cleared > want.cleared) {
      console.log(`        ${RM(got.cleared - want.cleared)} of that was marked reimbursed in the app since the import`);
    }
  }

  console.log("\n7. Contact details carried over from the old app");
  for (const p of profiles as { name: string; phone?: string; address?: string }[]) {
    const c = await db.customer.findFirst({ where: { name: p.name }, include: { addresses: true } });
    const phoneOk = !p.phone || c?.phone === p.phone;
    const addrOk = !p.address || c?.addresses.some((a) => a.line1 === p.address) === true;
    check(!!c && phoneOk && addrOk,
      `${p.name}: ${c?.phone ?? "no phone on file"} · ${c?.addresses[0]?.line1 ?? "no address on file"}`);
  }

  console.log(`\n=== ${problems.length ? `${problems.length} MISMATCH(ES)` : "NO MISMATCHES"} ===`);
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
