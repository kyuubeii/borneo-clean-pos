import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";
import { startOfDay, endOfDay } from "../dates";
import { notify } from "../notify";

const JOB_INCLUDE = {
  customer: true, address: true,
  assignments: { include: { staff: true } },
  checklist: { orderBy: { sort: "asc" } }, photos: true,
  timeEntries: { include: { staff: true } }, expenses: true, invoice: true,
} as const;

defineAction({
  name: "jobs.list",
  description: "List jobs filtered by date, status, cleaner or customer. Use for 'show me today's jobs', 'tomorrow's schedule', or a cleaner's workload.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({
    from: z.string().optional().describe("ISO date, inclusive"), to: z.string().optional(),
    status: z.enum(["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    staffId: z.string().optional(), customerId: z.string().optional(),
    limit: z.number().int().max(100).default(50),
  }),
  handler: async ({ from, to, status, staffId, customerId, limit }, ctx) => {
    // A cleaner only ever sees their own jobs, whoever is asking for them.
    if (ctx.user.role === "STAFF") staffId = ctx.user.staffId ?? "__none__";
    const rows = await db.job.findMany({
      where: {
        ...(status ? { status } : {}), ...(customerId ? { customerId } : {}),
        ...(staffId ? { assignments: { some: { staffId } } } : {}),
        ...(from || to ? { scheduledAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}),
      },
      orderBy: { scheduledAt: "asc" }, take: limit,
      include: { customer: true, address: true, assignments: { include: { staff: true } } },
    });
    return rows.map((j, n) => ({
      position: n + 1, id: j.id, ref: j.ref, status: j.status, scheduledAt: j.scheduledAt,
      durationMin: j.durationMin, customer: j.customer.name, customerId: j.customerId,
      address: j.address ? `${j.address.line1}${j.address.city ? ", " + j.address.city : ""}` : null,
      cleaners: j.assignments.map((a) => a.staff.name), revenueCents: j.revenueCents,
    }));
  },
});

defineAction({
  name: "jobs.get",
  description: "Get one job in full: instructions, notes, checklist, assigned cleaners, photos, time entries and costing.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ jobId: z.string() }),
  handler: async ({ jobId }, ctx) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: JOB_INCLUDE as any });
    if (!j) throw new ActionError("Job not found");
    if (ctx.user.role === "STAFF" && !(j as any).assignments.some((a: any) => a.staffId === ctx.user.staffId)) {
      throw new ActionError("You are not assigned to this job");
    }
    return j;
  },
});

defineAction({
  name: "jobs.updateStatus",
  description: "Change a job's status. Setting COMPLETED stamps the completion time and closes any open check-ins.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), status: z.enum(["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) }),
  handler: async ({ jobId, status }) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { customer: true } });
    if (!j) throw new ActionError("Job not found");
    if (status === "COMPLETED") {
      const open = await db.timeEntry.findMany({ where: { jobId, endAt: null } });
      for (const e of open) await db.timeEntry.update({ where: { id: e.id }, data: { endAt: new Date() } });
      if (j.bookingId) await db.booking.update({ where: { id: j.bookingId }, data: { status: "COMPLETED" } });
      await notify({ type: "JOB_COMPLETED", title: `Job ${j.ref} completed`, body: j.customer.name, link: `/jobs/${jobId}` });
    }
    return db.job.update({ where: { id: jobId }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
  },
});

defineAction({
  name: "jobs.reschedule",
  description: "Move a job to a new date/time, keeping its booking in step.",
  category: "Jobs", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ jobId: z.string(), scheduledAt: z.string().describe("New ISO datetime") }),
  handler: async ({ jobId, scheduledAt }) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { customer: true } });
    if (!j) throw new ActionError("Job not found");
    const when = new Date(scheduledAt);
    if (j.bookingId) await db.booking.update({ where: { id: j.bookingId }, data: { startAt: when } });
    await notify({ type: "SCHEDULE_CHANGE", title: `Job ${j.ref} moved`, body: `${j.customer.name} → ${when.toLocaleString("en-MY")}`, link: `/jobs/${jobId}` });
    return db.job.update({ where: { id: jobId }, data: { scheduledAt: when } });
  },
});

defineAction({
  name: "jobs.assignStaff",
  description: "Assign or reassign cleaners to a job. Replaces the current assignment list. The first cleaner becomes the lead.",
  category: "Jobs", roles: ["OWNER", "ADMIN"],
  input: z.object({ jobId: z.string(), staffIds: z.array(z.string()).describe("Full replacement list of staff IDs") }),
  handler: async ({ jobId, staffIds }) => {
    const j = await db.job.findUnique({ where: { id: jobId } });
    if (!j) throw new ActionError("Job not found");
    await db.jobAssignment.deleteMany({ where: { jobId } });
    if (staffIds.length) await db.jobAssignment.createMany({ data: staffIds.map((s, n) => ({ jobId, staffId: s, isLead: n === 0 })) });
    const staff = await db.staff.findMany({ where: { id: { in: staffIds } } });
    for (const s of staff) await notify({ type: "STAFF", title: `Assigned to job ${j.ref}`, body: s.name, link: `/jobs/${jobId}` });
    return { jobRef: j.ref, assigned: staff.map((s) => s.name) };
  },
});

defineAction({
  name: "jobs.update",
  description: "Update a job's instructions, internal notes, staff notes or material cost.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), customerInstructions: z.string().optional(),
    internalNotes: z.string().optional(), staffNotes: z.string().optional(),
    materialCostCents: z.number().int().min(0).optional(), durationMin: z.number().int().min(15).optional() }),
  handler: async ({ jobId, ...data }) => db.job.update({ where: { id: jobId }, data }),
});

defineAction({
  name: "jobs.setChecklist",
  description: "Replace a job's checklist items.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), items: z.array(z.string()) }),
  handler: async ({ jobId, items }) => {
    await db.checklistItem.deleteMany({ where: { jobId } });
    if (items.length) await db.checklistItem.createMany({ data: items.map((label, sort) => ({ jobId, label, sort })) });
    return db.checklistItem.findMany({ where: { jobId }, orderBy: { sort: "asc" } });
  },
});

defineAction({
  name: "jobs.toggleChecklistItem",
  description: "Tick or untick a single checklist item on a job.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ itemId: z.string(), done: z.boolean() }),
  handler: async ({ itemId, done }) => db.checklistItem.update({ where: { id: itemId }, data: { done } }),
});

defineAction({
  name: "jobs.addPhoto",
  description: "Attach a before/after photo or file to a job. The URL must already be uploaded.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), url: z.string(), kind: z.enum(["BEFORE", "AFTER", "ATTACHMENT"]).default("BEFORE"), caption: z.string().optional() }),
  handler: async (i) => db.photo.create({ data: i }),
});

defineAction({
  name: "jobs.costing",
  description: "Full job costing: revenue, labour cost from tracked time and pay rates, material cost, other expenses, profit and margin.",
  category: "Job Costing", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ jobId: z.string() }),
  handler: async ({ jobId }) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: {
      customer: true, timeEntries: { include: { staff: true } },
      assignments: { include: { staff: true } }, expenses: true,
    } });
    if (!j) throw new ActionError("Job not found");
    let labour = 0;
    const breakdown: { staff: string; minutes: number; costCents: number }[] = [];
    for (const a of j.assignments) {
      const mins = j.timeEntries.filter((t) => t.staffId === a.staffId)
        .reduce((x, t) => x + (t.endAt ? (t.endAt.getTime() - t.startAt.getTime()) / 60000 : 0), 0)
        || (j.status === "COMPLETED" ? j.durationMin : 0);
      const c = a.staff.payType === "HOURLY" ? Math.round((mins / 60) * a.staff.payRate)
        : a.staff.payType === "PER_JOB" ? a.staff.payRate
        : Math.round((j.revenueCents * a.staff.payRate) / 10000);
      labour += c;
      breakdown.push({ staff: a.staff.name, minutes: Math.round(mins), costCents: c });
    }
    const other = j.expenses.reduce((a, e) => a + e.amountCents, 0);
    const cost = labour + j.materialCostCents + other;
    const profit = j.revenueCents - cost;
    return {
      jobRef: j.ref, customer: j.customer.name, status: j.status,
      revenueCents: j.revenueCents, labourCents: labour, materialCents: j.materialCostCents,
      otherExpenseCents: other, totalCostCents: cost, profitCents: profit,
      marginPct: j.revenueCents > 0 ? +((profit / j.revenueCents) * 100).toFixed(1) : 0,
      labourBreakdown: breakdown,
    };
  },
});
