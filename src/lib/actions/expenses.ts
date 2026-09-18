import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";
import { nextRef } from "../ref";
import { startOfDay, endOfDay } from "../dates";

defineAction({
  name: "expenses.list",
  description: "List business expenses over a period, optionally filtered by category, job or staff member.",
  category: "Expenses", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional(), categoryId: z.string().optional(),
    jobId: z.string().optional(), staffId: z.string().optional(), reimbursableOnly: z.boolean().default(false),
    limit: z.number().int().max(200).default(100) }),
  handler: async ({ from, to, categoryId, jobId, staffId, reimbursableOnly, limit }) => {
    const rows = await db.expense.findMany({
      where: { ...(categoryId ? { categoryId } : {}), ...(jobId ? { jobId } : {}), ...(staffId ? { staffId } : {}),
        ...(reimbursableOnly ? { reimbursable: true, reimbursed: false } : {}),
        ...(from || to ? { spentAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}) },
      orderBy: { spentAt: "desc" }, take: limit, include: { category: true, job: true, staff: true },
    });
    return rows.map((e) => ({ id: e.id, ref: e.ref, amountCents: e.amountCents, spentAt: e.spentAt,
      category: e.category?.name ?? "Uncategorised", vendor: e.vendor, note: e.note,
      jobRef: e.job?.ref ?? null, staff: e.staff?.name ?? null,
      reimbursable: e.reimbursable, reimbursed: e.reimbursed, receiptUrl: e.receiptUrl }));
  },
});

defineAction({
  name: "expenses.record",
  description: "Record a business expense. Use for requests like 'record RM120 petrol expense for today'. Amounts are in cents. Link it to a job to include it in that job's costing.",
  category: "Expenses", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({
    amountCents: z.number().int().min(1).describe("Amount in cents, e.g. RM 120 is 12000"),
    categoryName: z.string().optional().describe("Category name; created if it does not exist, e.g. Fuel, Supplies"),
    jobId: z.string().optional(), staffId: z.string().optional(),
    vendor: z.string().optional(), note: z.string().optional(),
    spentAt: z.string().optional().describe("ISO date; defaults to now"),
    reimbursable: z.boolean().default(false), receiptUrl: z.string().optional(),
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
  handler: async ({ expenseId }) => db.expense.update({ where: { id: expenseId }, data: { reimbursed: true } }),
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

/* --------------------------------- Payroll --------------------------------- */

defineAction({
  name: "payroll.calculate",
  description: "Calculate what each cleaner has earned over a period, from tracked time and their pay setup. Does not create a payout.",
  category: "Payroll", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().describe("ISO date"), to: z.string().describe("ISO date"), staffId: z.string().optional() }),
  handler: async ({ from, to, staffId }) => {
    const gte = startOfDay(new Date(from)), lte = endOfDay(new Date(to));
    const staff = await db.staff.findMany({ where: { active: true, ...(staffId ? { id: staffId } : {}) } });
    const out = [];
    for (const s of staff) {
      const entries = await db.timeEntry.findMany({ where: { staffId: s.id, startAt: { gte, lte }, endAt: { not: null } } });
      const minutes = entries.reduce((a, e) => a + (e.endAt!.getTime() - e.startAt.getTime()) / 60000, 0);
      const jobs = await db.job.findMany({ where: { assignments: { some: { staffId: s.id } }, status: "COMPLETED", scheduledAt: { gte, lte } } });
      const revenue = jobs.reduce((a, j) => a + j.revenueCents, 0);
      const earned = s.payType === "HOURLY" ? Math.round((minutes / 60) * s.payRate)
        : s.payType === "PER_JOB" ? jobs.length * s.payRate
        : Math.round((revenue * s.payRate) / 10000);
      const reimbursements = await db.expense.aggregate({ _sum: { amountCents: true },
        where: { staffId: s.id, reimbursable: true, reimbursed: false, spentAt: { gte, lte } } });
      out.push({ staffId: s.id, name: s.name, payType: s.payType, payRate: s.payRate,
        hours: +(minutes / 60).toFixed(2), jobsCompleted: jobs.length, jobRevenueCents: revenue,
        earnedCents: earned, reimbursementsCents: reimbursements._sum.amountCents ?? 0,
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
  input: z.object({ staffId: z.string().optional(), status: z.enum(["PENDING", "PAID"]).optional() }),
  handler: async ({ staffId, status }) => {
    const rows = await db.payout.findMany({ where: { ...(staffId ? { staffId } : {}), ...(status ? { status } : {}) },
      orderBy: { periodEnd: "desc" }, include: { staff: true } });
    return rows.map((p) => ({ id: p.id, ref: p.ref, staff: p.staff.name, amountCents: p.amountCents,
      status: p.status, periodStart: p.periodStart, periodEnd: p.periodEnd, paidAt: p.paidAt }));
  },
});
