/**
 * Import the 31/07–17/09 transaction log.
 *
 *   npm run import:tx -- --yes
 *
 * Rules applied, from Oscar's brief:
 *  - Capital transfers are neither income nor expense; they go to CapitalEntry.
 *  - Collections settle earlier sales and never count as new sales.
 *  - "paid_to" is who physically received the money (Payment.receivedBy).
 *  - "paid_by" is who advanced an expense, so it is reimbursable unless cleared.
 */
import { PrismaClient } from "@prisma/client";
import data from "./import-data.json";

const db = new PrismaClient();
const C = (n: number) => Math.round(n * 100);
const at = (d: string, h = 10) => { const x = new Date(`${d}T00:00:00`); x.setHours(h, 0, 0, 0); return x; };

type Row = {
  d: string; k: string; amt: number; svc?: string; cat?: string;
  cust?: string; customer?: string; unit?: string; match?: string;
  to?: string; by?: string; person?: string; pay?: string;
  covers?: string; from?: string; cleared?: boolean; collected?: string; resolved?: string;
};
const rows = data as Row[];

async function main() {
  if (!process.argv.includes("--yes")) { console.error("Refusing to run without --yes"); process.exit(1); }
  if (await db.job.count()) { console.error("Jobs already exist. Run `npm run reset -- --yes` first."); process.exit(1); }

  /* ---- People who handle money ---- */
  const staff: Record<string, string> = {};
  // "Aaron" in the source log is Jong — same person, confirmed by Oscar.
  for (const [name, pay] of [["Oscar", 0], ["Jong", 0]] as const) {
    const s = await db.staff.create({ data: { name, payType: "PER_JOB", payRate: pay,
      notes: "Created by the transaction import — set pay details when you get a chance." } });
    staff[name] = s.id;
  }

  /* ---- Services actually sold ---- */
  const svcIds: Record<string, string> = {};
  for (const [name, nameZh, price, mins] of [
    ["House Cleaning", "住家清洁", 7000, 120],
    ["Aircon Cleaning", "冷气清洗", 12000, 90],
  ] as const) {
    const s = await db.service.create({ data: { name, nameZh, category: "Residential",
      priceCents: price, durationMin: mins, description: "Price varies per job; set on the booking." } });
    svcIds[name] = s.id;
  }

  /* ---- Customers ---- */
  const names = [...new Set(rows.filter((r) => r.customer).map((r) => r.customer!))].sort();
  const custIds: Record<string, string> = {};
  for (const name of names) {
    const unit = rows.find((r) => r.customer === name && r.unit)?.unit;
    const c = await db.customer.create({ data: {
      name, notes: unit ? `Urban unit ${unit} — recurring clean.` : null,
      createdAt: at(rows.find((r) => r.customer === name)!.d),
      addresses: unit ? { create: { label: `Unit ${unit}`, line1: `Urban Residence, Unit ${unit}`, city: "Kuching", state: "Sarawak", isPrimary: true } } : undefined,
    } });
    custIds[name] = c.id;
  }

  /* ---- Sales: booking -> job -> invoice, and a payment when it was paid ---- */
  let bN = 0, jN = 0, iN = 0, pN = 0, eN = 0;
  const ref = (p: string, n: number) => `${p}-${String(n).padStart(4, "0")}`;
  // Invoices kept per customer in date order, so collections settle the oldest first.
  const openByCustomer: Record<string, { id: string; cents: number; date: string }[]> = {};

  for (const r of rows.filter((x) => x.k === "INC")) {
    const custId = custIds[r.customer!];
    const svcName = r.svc === "Aircon Cleaning" ? "Aircon Cleaning" : "House Cleaning";
    const when = at(r.d);
    const cents = C(r.amt);
    const addr = await db.address.findFirst({ where: { customerId: custId, isPrimary: true } });

    const booking = await db.booking.create({ data: {
      ref: ref("BKG", ++bN), customerId: custId, addressId: addr?.id, startAt: when,
      durationMin: svcName === "Aircon Cleaning" ? 90 : 120, status: "COMPLETED", createdAt: when,
      internalNotes: r.match && r.match !== "given" ? `Customer matched from the old app by amount/date (${r.match} confidence) — verify.` : null,
      items: { create: { serviceId: svcIds[svcName], qty: 1, priceCents: cents, name: svcName } },
    } });
    const job = await db.job.create({ data: {
      ref: ref("JOB", ++jN), bookingId: booking.id, customerId: custId, addressId: addr?.id,
      scheduledAt: when, durationMin: booking.durationMin, status: "COMPLETED", completedAt: when,
      revenueCents: cents, createdAt: when,
      internalNotes: booking.internalNotes,
    } });
    const inv = await db.invoice.create({ data: {
      ref: ref("INV", ++iN), customerId: custId, issuedAt: when, dueAt: when, status: "SENT", createdAt: when,
      items: { create: { name: svcName, qty: 1, priceCents: cents } },
    } });
    await db.job.update({ where: { id: job.id }, data: { invoiceId: inv.id } });

    if (r.pay === "paid") {
      await db.payment.create({ data: {
        ref: ref("PAY", ++pN), invoiceId: inv.id, customerId: custId, amountCents: cents,
        method: "CASH", paidAt: when, createdAt: when,
        receivedById: r.to ? staff[r.to] : null,
        note: r.resolved ?? (r.to ? `Collected by ${r.to}` : null),
      } });
      await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } });
    } else {
      (openByCustomer[r.customer!] ??= []).push({ id: inv.id, cents, date: r.d });
    }
  }

  /* ---- Collections: settle the oldest open invoices, never new sales ---- */
  for (const r of rows.filter((x) => x.k === "COLLECTION")) {
    const name = r.customer!;
    const open = (openByCustomer[name] ?? []).sort((a, b) => a.date.localeCompare(b.date));
    let left = C(r.amt);
    const settled: string[] = [];
    while (left > 0 && open.length) {
      const inv = open[0];
      const pay = Math.min(left, inv.cents);
      await db.payment.create({ data: {
        ref: ref("PAY", ++pN), invoiceId: inv.id, customerId: custIds[name], amountCents: pay,
        method: "CASH", paidAt: at(r.d), createdAt: at(r.d), receivedById: r.to ? staff[r.to] : null,
        note: `Collection ${r.d} covering earlier visits (memo: ${r.covers}). Settlement of an earlier sale, not new income.`,
      } });
      inv.cents -= pay; left -= pay;
      if (inv.cents === 0) { await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } }); settled.push(inv.date); open.shift(); }
      else await db.invoice.update({ where: { id: inv.id }, data: { status: "PARTIAL" } });
    }
    console.log(`  collection ${r.d} ${name} RM ${r.amt} -> settled visits: ${settled.join(", ") || "(partial)"}`);
  }

  /* ---- Expenses ---- */
  const catIds: Record<string, string> = {};
  for (const name of [...new Set(rows.filter((r) => r.k === "EXP").map((r) => r.cat!))]) {
    const c = await db.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
    catIds[name] = c.id;
  }
  for (const r of rows.filter((x) => x.k === "EXP")) {
    const xref = ref("EXP", ++eN);
    if (!catIds[r.cat!]) throw new Error(`no category id for ${r.cat}`);
    await db.expense.create({ data: {
      ref: xref, categoryId: catIds[r.cat!], amountCents: C(r.amt),
      spentAt: at(r.d), createdAt: at(r.d),
      staffId: r.by ? staff[r.by] : null,
      vendor: r.person ?? null,
      note: r.person ? `Introducer commission — ${r.person}` : r.by ? `Advanced by ${r.by}` : null,
      reimbursable: !!r.by, reimbursed: !!r.cleared,
    } });
  }

  /* ---- Reimbursements: settle money already spent, so never a new expense ---- */
  let cN = 0;
  for (const r of rows.filter((x) => x.k === "REIMBURSEMENT")) {
    await db.payout.create({ data: {
      ref: `RMB-${String(++cN).padStart(4, "0")}`, kind: "REIMBURSEMENT",
      staffId: staff[r.to!], amountCents: C(r.amt),
      periodStart: at(r.d), periodEnd: at(r.d), status: "PAID", paidAt: at(r.d), createdAt: at(r.d),
      note: `Reimbursement to ${r.to} for expenses advanced, paid by ${r.from}. The underlying costs are already recorded as expenses, so this is not a new expense.`,
    } });
  }

  /* ---- Capital: excluded from P&L by design ---- */
  let capN = 0;
  for (const r of rows.filter((x) => x.k === "CAPITAL")) {
    await db.capitalEntry.create({ data: {
      ref: ref("CAP", ++capN), kind: "TRANSFER", amountCents: C(r.amt), occurredAt: at(r.d),
      fromId: r.from ? staff[r.from] : null, toId: r.to ? staff[r.to] : null,
      fromName: r.from, toName: r.to,
      note: "Capital transfer — not income or expense.",
    } });
  }

  console.log(`\nImported: ${bN} bookings/jobs, ${iN} invoices, ${pN} payments, ${eN} expenses, ${cN} reimbursements, ${capN} capital entries, ${names.length} customers`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
