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
  const unmatched: string[] = [];
  for (const r of src) {
    const key = `${r.d}|${C(r.amt)}`;
    const n = bag.get(key) ?? 0;
    if (n === 0) unmatched.push(`${r.d} ${RM(C(r.amt))}`);
    else bag.set(key, n - 1);
  }
  const surplus = [...bag.entries()].filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`);
  check(unmatched.length === 0, `${label}: every source row has a record on the same date${unmatched.length ? ` — missing ${unmatched.join(", ")}` : ""}`);
  check(surplus.length === 0, `${label}: no records the source does not have${surplus.length ? ` — extra ${surplus.join(", ")}` : ""}`);
}

async function main() {
  console.log(`Source: ${rows.length} rows, ${rows[0].d} to ${[...rows].sort((a, b) => a.d.localeCompare(b.d)).at(-1)!.d}\n`);

  const inc = rows.filter((r) => r.k === "INC");
  const exp = rows.filter((r) => r.k === "EXP");
  const col = rows.filter((r) => r.k === "COLLECTION");
  const rmb = rows.filter((r) => r.k === "REIMBURSEMENT");

  console.log("1. Everything in the log reached the app");
  const jobs = await db.job.findMany();
  const expenses = await db.expense.findMany({ include: { category: true } });
  const payouts = await db.payout.findMany();
  check(jobs.length === inc.length, `${inc.length} sales in the log, ${jobs.length} jobs in the app`);
  check(expenses.length === exp.length, `${exp.length} expenses in the log, ${expenses.length} in the app`);
  check(payouts.filter((p) => p.kind === "REIMBURSEMENT").length === rmb.length, `${rmb.length} reimbursements in the log, ${payouts.filter((p) => p.kind === "REIMBURSEMENT").length} in the app`);
  check(await db.capitalEntry.count() === 0, "no capital entries — the RM 2,000 is a reimbursement, not capital");

  console.log("\n2. Row by row, on date and amount");
  pair("sales", inc.map((r) => ({ d: r.d, amt: r.amt })), jobs.map((j) => ({ d: day(j.scheduledAt), cents: j.revenueCents })));
  pair("expenses", exp.map((r) => ({ d: r.d, amt: r.amt })), expenses.map((e) => ({ d: day(e.spentAt), cents: e.amountCents })));

  console.log("\n3. Totals");
  const sales = inc.reduce((a, r) => a + C(r.amt), 0);
  const spend = exp.reduce((a, r) => a + C(r.amt), 0);
  const cash = inc.filter((r) => r.pay === "paid").reduce((a, r) => a + C(r.amt), 0) + col.reduce((a, r) => a + C(r.amt), 0);
  check(jobs.reduce((a, j) => a + j.revenueCents, 0) === sales, `sales ${RM(sales)}`);
  check(expenses.reduce((a, e) => a + e.amountCents, 0) === spend, `expenses ${RM(spend)}`);
  const payments = await db.payment.findMany();
  check(payments.reduce((a, p) => a + p.amountCents, 0) === cash, `cash received ${RM(cash)}`);
  const invoices = await db.invoice.findMany({ include: { items: true } });
  const billed = invoices.reduce((a, i) => a + i.items.reduce((b, x) => b + x.priceCents * x.qty, 0), 0);
  check(billed === sales, `invoiced ${RM(billed)} — every sale has an invoice for the same amount`);
  check(billed - payments.reduce((a, p) => a + p.amountCents, 0) === sales - cash, `outstanding ${RM(sales - cash)}`);
  console.log(`        profit ${RM(sales - spend)} on an accrual basis`);

  console.log("\n4. Collections settle old invoices — they are never new sales");
  for (const c of col) {
    const sameDay = jobs.filter((j) => day(j.scheduledAt) === c.d);
    check(sameDay.length === inc.filter((r) => r.d === c.d).length, `${c.d}: ${sameDay.length} jobs, matching the ${inc.filter((r) => r.d === c.d).length} sales logged that day`);
  }

  console.log("\n5. The reimbursement is not double-counted");
  for (const r of rmb) {
    const asExpense = expenses.filter((e) => e.amountCents === C(r.amt) && day(e.spentAt) === r.d);
    check(asExpense.length === 0, `${r.d} ${RM(C(r.amt))} repayment is not also an expense`);
  }
  check((await db.staff.findMany()).every((s) => s.name !== "Aaron"), "no duplicate \"Aaron\" — merged into Jong");

  console.log("\n6. What is still owed to whoever paid out of pocket");
  const staff = await db.staff.findMany();
  for (const s of staff) {
    const adv = exp.filter((r) => r.by === s.name);
    const advanced = adv.reduce((a, r) => a + C(r.amt), 0);
    const cleared = adv.filter((r) => r.cleared).reduce((a, r) => a + C(r.amt), 0);
    const repaid = rmb.filter((r) => r.to === s.name).reduce((a, r) => a + C(r.amt), 0);
    const mine = expenses.filter((e) => e.staffId === s.id);
    check(mine.reduce((a, e) => a + e.amountCents, 0) === advanced,
      `${s.name} advanced ${RM(advanced)}, cleared ${RM(cleared)}, repaid ${RM(repaid)} -> still owed ${RM(advanced - cleared - repaid)}`);
  }

  console.log("\n7. Contact details carried over from the old app");
  for (const p of profiles as { name: string; phone?: string; address?: string }[]) {
    const c = await db.customer.findFirst({ where: { name: p.name }, include: { addresses: true } });
    check(!!c && (!p.phone || !!c.phone) && (!p.address || c.addresses.length > 0),
      `${p.name}: ${c?.phone ?? "no phone on file"} · ${c?.addresses[0]?.line1 ?? "no address on file"}`);
  }

  console.log(`\n=== ${problems.length ? `${problems.length} MISMATCH(ES)` : "NO MISMATCHES"} ===`);
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
