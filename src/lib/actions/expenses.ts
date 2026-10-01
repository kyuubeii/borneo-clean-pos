import { z } from "zod";
import { db } from "../db";
import { optionalId, optionalText } from "../schema";
import { defineAction, ActionError } from "../registry";
import { nextRef } from "../ref";
import { startOfDay, endOfDay } from "../dates";
import { labourFor } from "../labour";

defineAction({
  name: "expenses.list",
  description: "List business expenses over a period, optionally filtered by category, job or staff member.",
  category: "Expenses", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional(), categoryId: optionalId(),
    jobId: optionalId(), staffId: optionalId(), reimbursableOnly: z.boolean().default(false),
    limit: z.number().int().max(200).default(100) }),
  handler: async ({ from, to, categoryId, jobId, staffId, reimbursableOnly, limit }, ctx) => {
    // A cleaner only ever sees expenses they themselves submitted.
    if (ctx.user.role === "STAFF") staffId = ctx.user.staffId ?? "__none__";
    const rows = await db.expense.findMany({
      where: { ...(categoryId ? { categoryId } : {}), ...(jobId ? { jobId } : {}), ...(staffId ? { staffId } : {}),
        ...(reimbursableOnly ? { reimbursable: true, reimbursed: false } : {}),
        ...(from || to ? { spentAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}) },
      orderBy: { spentAt: "desc" }, take: limit, include: { category: true, job: true, staff: true },
    });
    // The ids come back as well as the names so an edit form can be filled in from the list.
    return rows.map((e) => ({ id: e.id, ref: e.ref, amountCents: e.amountCents, spentAt: e.spentAt,
      category: e.category?.name ?? "Uncategorised", categoryId: e.categoryId, vendor: e.vendor, note: e.note,
      jobId: e.jobId, jobRef: e.job?.ref ?? null, jobCancelled: e.job?.status === "CANCELLED", staffId: e.staffId, staff: e.staff?.name ?? null,
      reimbursable: e.reimbursable, reimbursed: e.reimbursed, receiptUrl: e.receiptUrl }));
  },
});

defineAction({
  name: "expenses.record",
  description: "Record a business expense. Use for requests like 'record RM120 petrol expense for today'. Amounts are in cents. Link it to a job to include it in that job's costing.",
  category: "Expenses", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({
    amountCents: z.number().int().min(1).describe("Amount in cents, e.g. RM 120 is 12000"),
    categoryName: optionalText().describe("Category name; created if it does not exist, e.g. Fuel, Supplies"),
    jobId: optionalId(), staffId: optionalId(),
    vendor: z.string().optional(), note: z.string().optional(),
    spentAt: z.string().optional().describe("ISO date; defaults to now"),
    reimbursable: z.boolean().default(false), receiptUrl: optionalText(),
  }),
  handler: async (i) => {
    let categoryId: string | undefined;
    if (i.categoryName) {
      const c = await db.expenseCategory.upsert({ where: { name: i.categoryName }, update: {}, create: { name: i.categoryName } });
      categoryId = c.id;
    }
    return db.expense.create({ data: {
      ref: await nextRef("EXP", "expense"), amountCents: i.amountCents, categoryId,
      jobId: i.jobId, staffId: i.staffId, vendor: i.vendor, note: i.note,
      spentAt: i.spentAt ? new Date(i.spentAt) : new Date(),
      reimbursable: i.reimbursable, receiptUrl: i.receiptUrl,
    }, include: { category: true } });
  },
});

defineAction({
  name: "expenses.markReimbursed",
  description: "Mark a reimbursable expense as paid back to the staff member.",
  category: "Expenses", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ expenseId: z.string() }),
  handler: async ({ expenseId }) => {
    const e = await db.expense.findUnique({ where: { id: expenseId } });
    if (!e) throw new Error("That expense does not exist.");
    if (e.reimbursed) return e;
    // A payout already pays the person back on account. Ticking rows it has covered
    // would subtract the same money twice, so stop before the total goes past the debt.
    if (e.staffId) {
      const mine = await db.expense.findMany({ where: { staffId: e.staffId } });
      const advanced = mine.reduce((a, x) => a + x.amountCents, 0);
      const settled = mine.filter((x) => x.reimbursed).reduce((a, x) => a + x.amountCents, 0);
      if (settled + e.amountCents > advanced) {
        const rm = (c: number) => `RM ${(c / 100).toFixed(2)}`;
        throw new Error(
          `That would mark more as repaid than was ever advanced: ${rm(settled)} of ${rm(advanced)} is already ticked, and this row is ${rm(e.amountCents)}.`);
      }
    }
    return db.expense.update({ where: { id: expenseId }, data: { reimbursed: true } });
  },
});

defineAction({
  name: "expenses.categories",
  description: "List expense categories.",
  category: "Expenses", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({}),
  handler: async () => db.expenseCategory.findMany({ orderBy: { name: "asc" } }),
});

defineAction({
  name: "expenses.createCategory",
  description: "Create a new expense category.",
  category: "Expenses", roles: ["OWNER", "ADMIN"],
  input: z.object({ name: z.string().min(1), nameZh: z.string().optional() }),
  handler: async (i) => db.expenseCategory.create({ data: i }),
});

defineAction({
  name: "staff.advances",
  description: "What the business still owes each person for expenses they paid out of their own pocket: total advanced, less what has been paid back. A reimbursement payout and a row marked reimbursed are two records of the same repayment, so the credit is the larger of the two rather than the sum.",
  category: "Expenses", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ staffId: z.string().optional() }),
  handler: async ({ staffId }, ctx) => {
    // A cleaner only ever sees their own position.
    if (ctx.user.role === "STAFF") staffId = ctx.user.staffId ?? "__none__";
    const staff = await db.staff.findMany({ where: staffId ? { id: staffId } : {} });
    const out = [];
    for (const s of staff) {
      const adv = await db.expense.findMany({ where: { staffId: s.id } });
      if (!adv.length) continue;
      const advanced = adv.reduce((a, e) => a + e.amountCents, 0);
      // Two records of the same repayment: the payouts are the cash that went back, and
      // ticking a row says which advance that cash covered. Adding them would count the
      // money twice, so the credit is the larger of the two, not the sum.
      const cleared = adv.filter((e) => e.reimbursed).reduce((a, e) => a + e.amountCents, 0);
      const repaid = (await db.payout.findMany({ where: { staffId: s.id, kind: "REIMBURSEMENT", status: "PAID" } }))
        .reduce((a, p) => a + p.amountCents, 0);
      const credit = Math.max(cleared, repaid);
      out.push({ staffId: s.id, name: s.name, advancedCents: advanced, clearedCents: cleared,
        repaidCents: repaid, unallocatedCents: Math.max(0, repaid - cleared),
        stillOwedCents: advanced - credit, entries: adv.length });
    }
    return out.sort((a, b) => b.stillOwedCents - a.stillOwedCents);
  },
});

/* --------------------------------- Payroll --------------------------------- */

defineAction({
  name: "payroll.calculate",
  description: "Calculate what each cleaner has earned over a period: for each completed job, the labour amount set on the job, otherwise their pay rate (hourly on tracked or scheduled time, per job, or a share of the job). Plus unpaid reimbursements. Does not create a payout.",
  category: "Payroll", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().describe("ISO date"), to: z.string().describe("ISO date"), staffId: optionalId() }),
  handler: async ({ from, to, staffId }) => {
    const gte = startOfDay(new Date(from)), lte = endOfDay(new Date(to));
    const staff = await db.staff.findMany({ where: { active: true, ...(staffId ? { id: staffId } : {}) } });
    const out = [];
    for (const s of staff) {
      // Pay is worked out job by job with the same labourFor() the job's costing
      // uses, so an amount set by hand on a job is exactly what gets paid here.
      const jobs = await db.job.findMany({
        where: { assignments: { some: { staffId: s.id } }, status: "COMPLETED", scheduledAt: { gte, lte } },
        include: { assignments: { where: { staffId: s.id }, include: { staff: true } }, timeEntries: { where: { staffId: s.id } } },
      });
      const lines = jobs.map((j) => labourFor(j, j.assignments[0], j.timeEntries));
      const minutes = lines.reduce((a, l) => a + l.minutes, 0);
      const revenue = jobs.reduce((a, j) => a + j.revenueCents, 0);
      const earned = lines.reduce((a, l) => a + l.costCents, 0);
      const fixedJobs = lines.filter((l) => l.fixed).length;
      const reimbursements = await db.expense.aggregate({ _sum: { amountCents: true },
        where: { staffId: s.id, reimbursable: true, reimbursed: false, spentAt: { gte, lte } } });
      out.push({ staffId: s.id, name: s.name, payType: s.payType, payRate: s.payRate,
        hours: +(minutes / 60).toFixed(2), jobsCompleted: jobs.length, jobRevenueCents: revenue,
        earnedCents: earned, fixedJobs, reimbursementsCents: reimbursements._sum.amountCents ?? 0,
        totalCents: earned + (reimbursements._sum.amountCents ?? 0) });
    }
    return { from: gte, to: lte, lines: out, grandTotalCents: out.reduce((a, o) => a + o.totalCents, 0) };
  },
});

defineAction({
  name: "payroll.createPayout",
  description: "Create a payout record for a cleaner covering a pay period.",
  category: "Payroll", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ staffId: z.string(), periodStart: z.string(), periodEnd: z.string(),
    amountCents: z.number().int().min(1), note: z.string().optional() }),
  handler: async (i) => db.payout.create({ data: {
    ref: await nextRef("PO", "payout"), staffId: i.staffId, amountCents: i.amountCents,
    periodStart: new Date(i.periodStart), periodEnd: new Date(i.periodEnd), note: i.note,
  }, include: { staff: true } }),
});

defineAction({
  name: "payroll.markPaid",
  description: "Mark a payout as paid.",
  category: "Payroll", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ payoutId: z.string() }),
  handler: async ({ payoutId }) => db.payout.update({ where: { id: payoutId }, data: { status: "PAID", paidAt: new Date() } }),
});

defineAction({
  name: "payroll.list",
  description: "List payouts, including which are still outstanding.",
  category: "Payroll", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ staffId: optionalId(), status: z.enum(["PENDING", "PAID"]).optional() }),
  handler: async ({ staffId, status }) => {
    const rows = await db.payout.findMany({ where: { ...(staffId ? { staffId } : {}), ...(status ? { status } : {}) },
      orderBy: { periodEnd: "desc" }, include: { staff: true } });
    return rows.map((p) => ({ id: p.id, ref: p.ref, staff: p.staff.name, amountCents: p.amountCents,
      status: p.status, periodStart: p.periodStart, periodEnd: p.periodEnd, paidAt: p.paidAt }));
  },
});
