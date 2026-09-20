import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction } from "../registry";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, addDays, isoDate } from "../dates";
import { invoiceTotals } from "./finance";

function range(from?: string, to?: string) {
  const gte = from ? startOfDay(new Date(from)) : startOfMonth(new Date());
  const lte = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
  return { gte, lte };
}

/** Revenue is recognised from payments received, not invoices raised. */
async function revenueIn(gte: Date, lte: Date) {
  // Summed in the database, in one round trip. Loading every payment row to add
  // it up in JS cost the same trip but grew with the table.
  const rows = await db.payment.groupBy({
    by: ["isRefund"], _sum: { amountCents: true }, where: { paidAt: { gte, lte } },
  });
  return rows.reduce((a, r) => a + (r.isRefund ? -1 : 1) * (r._sum.amountCents ?? 0), 0);
}

defineAction({
  name: "reports.summary",
  description: "Headline business figures for a period: sales earned, cash collected, expenses, labour cost, profit, margin, job counts and new customers. Profit is sales minus costs (accrual); revenueCollectedCents is cash actually received. Use for 'how much did we make this month'.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional().describe("ISO date; defaults to start of this month"), to: z.string().optional() }),
  handler: async ({ from, to }) => {
    const { gte, lte } = range(from, to);
    // Five independent queries. Awaited one after another they cost the sum of
    // five round trips; nothing here depends on anything else, so they go together.
    const [revenue, invoices, expenses, jobs, newCustomers] = await Promise.all([
      revenueIn(gte, lte),
      db.invoice.findMany({ where: { issuedAt: { gte, lte }, status: { not: "VOID" } }, include: { items: true, payments: true } }),
      db.expense.aggregate({ _sum: { amountCents: true }, where: { spentAt: { gte, lte } } }),
      db.job.findMany({ where: { scheduledAt: { gte, lte } }, include: { assignments: { include: { staff: true } }, timeEntries: true } }),
      db.customer.count({ where: { createdAt: { gte, lte } } }),
    ]);
    const invoiced = invoices.reduce((a, i) => a + invoiceTotals(i).total, 0);

    let labour = 0;
    for (const j of jobs.filter((x) => x.status === "COMPLETED")) {
      for (const a of j.assignments) {
        const mins = j.timeEntries.filter((t) => t.staffId === a.staffId && t.endAt)
          .reduce((x, t) => x + (t.endAt!.getTime() - t.startAt.getTime()) / 60000, 0) || j.durationMin;
        labour += a.staff.payType === "HOURLY" ? Math.round((mins / 60) * a.staff.payRate)
          : a.staff.payType === "PER_JOB" ? a.staff.payRate
          : Math.round((j.revenueCents * a.staff.payRate) / 10000);
      }
    }
    const expenseCents = expenses._sum.amountCents ?? 0;
    // Sales earned in the period, whether or not the money has come in yet.
    // Profit must compare like with like: expenses are recorded on the date they are
    // incurred, so revenue has to be sales earned, not cash collected. Mixing the two
    // (cash in vs accrued costs) understates profit whenever customers pay late.
    const billable = jobs.filter((j) => j.status !== "CANCELLED");
    const salesCents = billable.reduce((a, j) => a + j.revenueCents, 0);
    const profit = salesCents - expenseCents - labour;
    return {
      from: gte, to: lte,
      salesCents, revenueCollectedCents: revenue, invoicedCents: invoiced,
      outstandingCents: Math.max(0, salesCents - revenue),
      expenseCents, labourCents: labour, profitCents: profit,
      marginPct: salesCents > 0 ? +((profit / salesCents) * 100).toFixed(1) : 0,
      jobsScheduled: jobs.length, jobsCompleted: jobs.filter((j) => j.status === "COMPLETED").length,
      jobsCancelled: jobs.filter((j) => j.status === "CANCELLED").length,
      newCustomers,
      // Averaged over the same jobs `salesCents` is built from. This used to divide
      // the revenue of every job, cancelled ones included, by the count of every
      // job -- two different definitions of the month's work, three lines apart.
      avgJobValueCents: billable.length ? Math.round(salesCents / billable.length) : 0,
    };
  },
});

defineAction({
  name: "reports.revenueByService",
  description: "Revenue broken down by service over a period. Use for 'which service generated the most revenue this month'.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional() }),
  handler: async ({ from, to }) => {
    const { gte, lte } = range(from, to);
    const items = await db.bookingItem.findMany({
      where: { booking: { startAt: { gte, lte }, status: { not: "CANCELLED" } } },
      include: { service: true },
    });
    const map = new Map<string, { service: string; category: string; jobs: number; revenueCents: number }>();
    for (const i of items) {
      const e = map.get(i.serviceId) ?? { service: i.service.name, category: i.service.category, jobs: 0, revenueCents: 0 };
      e.jobs += i.qty; e.revenueCents += i.qty * i.priceCents; map.set(i.serviceId, e);
    }
    return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  },
});

defineAction({
  name: "reports.revenueTrend",
  description: "Daily or monthly revenue trend for charting over a period.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional(), granularity: z.enum(["day", "month"]).default("day") }),
  handler: async ({ from, to, granularity }) => {
    const { gte, lte } = range(from, to);
    const pays = await db.payment.findMany({ where: { paidAt: { gte, lte } }, orderBy: { paidAt: "asc" } });
    // Bucket by local calendar day/month so periods line up with the range shown.
    const key = (d: Date) => granularity === "day" ? isoDate(d) : isoDate(d).slice(0, 7);
    const map = new Map<string, number>();
    if (granularity === "day") for (let d = new Date(gte); d <= lte; d = addDays(d, 1)) map.set(key(d), 0);
    for (const p of pays) map.set(key(p.paidAt), (map.get(key(p.paidAt)) ?? 0) + (p.isRefund ? -p.amountCents : p.amountCents));
    return [...map.entries()].map(([period, revenueCents]) => ({ period, revenueCents }));
  },
});

defineAction({
  name: "reports.topCustomers",
  description: "Customers ranked by money actually paid over a period, with job counts.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional(), limit: z.number().int().max(50).default(10) }),
  handler: async ({ from, to, limit }) => {
    const { gte, lte } = range(from, to);
    const pays = await db.payment.findMany({ where: { paidAt: { gte, lte } }, include: { customer: true } });
    const map = new Map<string, { customer: string; customerId: string; paidCents: number; payments: number }>();
    for (const p of pays) {
      const e = map.get(p.customerId) ?? { customer: p.customer.name, customerId: p.customerId, paidCents: 0, payments: 0 };
      e.paidCents += p.isRefund ? -p.amountCents : p.amountCents; e.payments++; map.set(p.customerId, e);
    }
    return [...map.values()].sort((a, b) => b.paidCents - a.paidCents).slice(0, limit);
  },
});

defineAction({
  name: "reports.staffPerformance",
  description: "Per-cleaner performance over a period: jobs completed, hours worked, revenue generated and cost.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional() }),
  handler: async ({ from, to }) => {
    const { gte, lte } = range(from, to);
    // Three queries total, whatever the headcount. This used to run two queries
    // per staff member in a loop, so twenty cleaners meant forty round trips.
    const [staff, jobs, entries] = await Promise.all([
      db.staff.findMany({ where: { active: true } }),
      db.job.findMany({
        where: { scheduledAt: { gte, lte }, assignments: { some: { staff: { active: true } } } },
        select: { status: true, revenueCents: true, assignments: { select: { staffId: true } } },
      }),
      db.timeEntry.findMany({
        where: { startAt: { gte, lte }, endAt: { not: null } },
        select: { staffId: true, startAt: true, endAt: true },
      }),
    ]);

    const minutesBy = new Map<string, number>();
    for (const e of entries) {
      minutesBy.set(e.staffId, (minutesBy.get(e.staffId) ?? 0) + (e.endAt!.getTime() - e.startAt.getTime()) / 60000);
    }
    const jobsBy = new Map<string, { assigned: number; completed: number; revenueCents: number }>();
    for (const j of jobs) {
      for (const a of j.assignments) {
        const e = jobsBy.get(a.staffId) ?? { assigned: 0, completed: 0, revenueCents: 0 };
        e.assigned++;
        if (j.status === "COMPLETED") { e.completed++; e.revenueCents += j.revenueCents; }
        jobsBy.set(a.staffId, e);
      }
    }

    return staff.map((s) => {
      const j = jobsBy.get(s.id) ?? { assigned: 0, completed: 0, revenueCents: 0 };
      const minutes = minutesBy.get(s.id) ?? 0;
      return { staffId: s.id, name: s.name, jobsAssigned: j.assigned, jobsCompleted: j.completed,
        completionRate: j.assigned ? +((j.completed / j.assigned) * 100).toFixed(0) : 0,
        hours: +(minutes / 60).toFixed(1),
        revenueGeneratedCents: j.revenueCents };
    }).sort((a, b) => b.revenueGeneratedCents - a.revenueGeneratedCents);
  },
});

defineAction({
  name: "reports.expenseBreakdown",
  description: "Expenses grouped by category over a period.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional() }),
  handler: async ({ from, to }) => {
    const { gte, lte } = range(from, to);
    const rows = await db.expense.findMany({ where: { spentAt: { gte, lte } }, include: { category: true } });
    const map = new Map<string, { category: string; count: number; amountCents: number }>();
    for (const e of rows) {
      const name = e.category?.name ?? "Uncategorised";
      const x = map.get(name) ?? { category: name, count: 0, amountCents: 0 };
      x.count++; x.amountCents += e.amountCents; map.set(name, x);
    }
    return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
  },
});

defineAction({
  name: "reports.dailyBriefing",
  description: "Summary of today's business activity: jobs today, their status, revenue collected, new bookings and anything needing attention. Use for 'summarize today's business activity'.",
  category: "Reports", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ date: z.string().optional().describe("ISO date; defaults to today") }),
  handler: async ({ date }) => {
    const d = date ? new Date(date) : new Date();
    const gte = startOfDay(d), lte = endOfDay(d);
    // Independent queries, issued together rather than one round trip at a time.
    const [jobs, revenue, newBookings, expenses, outstanding] = await Promise.all([
      db.job.findMany({ where: { scheduledAt: { gte, lte } },
        include: { customer: true, assignments: { include: { staff: true } } }, orderBy: { scheduledAt: "asc" } }),
      revenueIn(gte, lte),
      db.booking.count({ where: { createdAt: { gte, lte } } }),
      db.expense.aggregate({ _sum: { amountCents: true }, where: { spentAt: { gte, lte } } }),
      db.invoice.findMany({ where: { dueAt: { lt: new Date() }, status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
        include: { items: true, payments: true } }),
    ]);
    const unassigned = jobs.filter((j) => j.assignments.length === 0 && j.status !== "CANCELLED");
    return {
      date: gte,
      jobs: jobs.map((j) => ({ ref: j.ref, time: j.scheduledAt, customer: j.customer.name, status: j.status,
        cleaners: j.assignments.map((a) => a.staff.name) })),
      jobsTotal: jobs.length, completed: jobs.filter((j) => j.status === "COMPLETED").length,
      inProgress: jobs.filter((j) => j.status === "IN_PROGRESS").length,
      revenueCollectedCents: revenue, expensesCents: expenses._sum.amountCents ?? 0,
      newBookings,
      needsAttention: {
        unassignedJobs: unassigned.map((j) => ({ ref: j.ref, customer: j.customer.name, time: j.scheduledAt })),
        overdueInvoices: outstanding.length,
        overdueAmountCents: outstanding.reduce((a, i) => a + invoiceTotals(i).balance, 0),
      },
    };
  },
});

defineAction({
  name: "reports.myDay",
  description: "A cleaner's own day: their jobs for a date, their open check-in, hours worked this week and pay earned so far.",
  category: "Reports", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ date: z.string().optional().describe("ISO date; defaults to today"), staffId: optionalId() }),
  handler: async ({ date, staffId }, ctx) => {
    const id = ctx.user.role === "STAFF" ? ctx.user.staffId : (staffId ?? ctx.user.staffId);
    if (!id) throw new Error("No cleaner profile is linked to this account");
    const d = date ? new Date(date) : new Date();
    const gte = startOfDay(d), lte = endOfDay(d);
    const jobs = await db.job.findMany({
      where: { assignments: { some: { staffId: id } }, scheduledAt: { gte, lte } },
      orderBy: { scheduledAt: "asc" }, include: { customer: true, address: true, checklist: true },
    });
    const weekStart = startOfDay(addDays(d, -6));
    const entries = await db.timeEntry.findMany({ where: { staffId: id, startAt: { gte: weekStart, lte } } });
    const minutes = entries.reduce((a, e) => a + (e.endAt ? (e.endAt.getTime() - e.startAt.getTime()) / 60000 : 0), 0);
    const open = entries.find((e) => !e.endAt);
    const staff = await db.staff.findUnique({ where: { id } });
    const earned = staff?.payType === "HOURLY" ? Math.round((minutes / 60) * staff.payRate) : 0;
    const upcoming = await db.job.count({ where: { assignments: { some: { staffId: id } }, scheduledAt: { gt: lte }, status: { notIn: ["CANCELLED", "COMPLETED"] } } });
    return {
      date: gte, staffName: staff?.name,
      jobs: jobs.map((j) => ({ id: j.id, ref: j.ref, time: j.scheduledAt, status: j.status,
        customer: j.customer.name, durationMin: j.durationMin,
        address: j.address ? [j.address.line1, j.address.city].filter(Boolean).join(", ") : null,
        checklistDone: j.checklist.filter((c) => c.done).length, checklistTotal: j.checklist.length })),
      jobsToday: jobs.length, completedToday: jobs.filter((j) => j.status === "COMPLETED").length,
      upcomingJobs: upcoming,
      hoursThisWeek: +(minutes / 60).toFixed(1), earnedThisWeekCents: earned,
      checkedInToJobId: open?.jobId ?? null,
    };
  },
});

defineAction({
  name: "audit.list",
  description: "Read the audit log of actions taken in the system, including everything the AI assistant did.",
  category: "Admin", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ source: z.enum(["ui", "assistant", "system"]).optional(), limit: z.number().int().max(200).default(50) }),
  handler: async ({ source, limit }) => db.auditLog.findMany({
    where: source ? { source } : {}, orderBy: { createdAt: "desc" }, take: limit }),
});
