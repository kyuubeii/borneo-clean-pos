import { assertAvailable, scheduleWrite, setJobStatus } from "../scheduling";
import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { startOfDay, endOfDay } from "../dates";
import { notify } from "../notify";
import { isUploadedFileUrl } from "../storage";

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
    staffId: optionalId(), customerId: optionalId(),
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
      staffIds: j.assignments.map((a) => a.staffId), cleaners: j.assignments.map((a) => a.staff.name), revenueCents: j.revenueCents,
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
  handler: async ({ jobId, status }) => scheduleWrite(async (db) => setJobStatus(db, jobId, status)),
});

defineAction({
  name: "jobs.reschedule",
  description: "Move a job to a new date/time, keeping its booking in step.",
  category: "Jobs", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ jobId: z.string(), scheduledAt: z.string().describe("New ISO datetime") }),
  handler: async ({ jobId, scheduledAt }) => scheduleWrite(async (db) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { customer: true, assignments: true } });
    if (!j) throw new ActionError("Job not found");
    const when = new Date(scheduledAt);
    await assertAvailable(db, j.assignments.map((a: any) => a.staffId), when, j.durationMin, jobId);
    if (j.bookingId) await db.booking.update({ where: { id: j.bookingId }, data: { startAt: when } });
    await notify({ type: "SCHEDULE_CHANGE", title: `Job ${j.ref} moved`, body: `${j.customer.name} → ${when.toLocaleString("en-MY")}`, link: `/jobs/${jobId}` }, db);
    return db.job.update({ where: { id: jobId }, data: { scheduledAt: when } });
  }),
});

defineAction({
  name: "jobs.assignStaff",
  description: "Assign or reassign cleaners to a job. Replaces the current assignment list. The first cleaner becomes the lead.",
  category: "Jobs", roles: ["OWNER", "ADMIN"],
  input: z.object({ jobId: z.string(), staffIds: z.array(z.string()).describe("Full replacement list of staff IDs") }),
  handler: async ({ jobId, staffIds }) => scheduleWrite(async (db) => {
    const j = await db.job.findUnique({ where: { id: jobId } });
    if (!j) throw new ActionError("Job not found");
    await assertAvailable(db, staffIds, j.scheduledAt, j.durationMin, jobId);
    await db.jobAssignment.deleteMany({ where: { jobId } });
    if (staffIds.length) await db.jobAssignment.createMany({ data: staffIds.map((s, n) => ({ jobId, staffId: s, isLead: n === 0 })) });
    const staff = await db.staff.findMany({ where: { id: { in: staffIds } } });
    for (const s of staff) await notify({ type: "STAFF", title: `Assigned to job ${j.ref}`, body: s.name, link: `/jobs/${jobId}` }, db);
    return { jobRef: j.ref, assigned: staff.map((s: any) => s.name) };
  }),
});

defineAction({
  name: "jobs.update",
  description: "Update a job's instructions, internal notes, staff notes or material cost.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), customerInstructions: z.string().optional(),
    internalNotes: z.string().optional(), staffNotes: z.string().optional(),
    materialCostCents: z.number().int().min(0).optional(), durationMin: z.number().int().min(15).optional() }),
  handler: async ({ jobId, ...data }) => scheduleWrite(async (db) => {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { assignments: true } });
    if (!job) throw new ActionError("Job not found");
    if (data.durationMin !== undefined && data.durationMin !== job.durationMin) {
      if (!["COMPLETED", "CANCELLED"].includes(job.status)) await assertAvailable(db, job.assignments.map((a: any) => a.staffId), job.scheduledAt, data.durationMin, jobId);
      if (job.bookingId) await db.booking.update({ where: { id: job.bookingId }, data: { durationMin: data.durationMin } });
    }
    return db.job.update({ where: { id: jobId }, data });
  }),
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
  description: "Attach a before/after photo or file to a job. The URL must be one returned by the upload endpoint -- this does not accept an arbitrary web address.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({
    jobId: z.string(),
    url: z.string().url("A photo URL must be a full https:// address returned by the uploader"),
    kind: z.enum(["BEFORE", "AFTER", "ATTACHMENT"]).default("BEFORE"), caption: z.string().optional(),
  }),
  handler: async (i) => {
    const job = await db.job.findUnique({ where: { id: i.jobId }, select: { id: true } });
    if (!job) throw new ActionError("Job not found");
    // Anything but a file this app uploaded renders as a broken image and can
    // never be fixed, because the picture was never ours to serve. A plain
    // http:// address is also blocked by the browser on an https page.
    if (!isUploadedFileUrl(i.url)) {
      throw new ActionError("Photos have to be uploaded through the Add button. A link to a picture somewhere else cannot be attached.");
    }
    return db.photo.create({ data: i });
  },
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
    let anyEstimated = false;
    const breakdown: { staff: string; minutes: number; costCents: number; payType: string; estimated: boolean; noRate: boolean }[] = [];
    for (const a of j.assignments) {
      const tracked = j.timeEntries.filter((t) => t.staffId === a.staffId)
        .reduce((x, t) => x + (t.endAt ? (t.endAt.getTime() - t.startAt.getTime()) / 60000 : 0), 0);
      // A check-in closed seconds after it was opened is a mis-tap, not work.
      // Anything under a minute is treated as untracked, so a completed job
      // falls back to its scheduled duration instead of costing a stray cent.
      const useTracked = tracked >= 1;
      const estimated = !useTracked && j.status === "COMPLETED";
      const mins = useTracked ? tracked : estimated ? j.durationMin : 0;
      const c = a.staff.payType === "HOURLY" ? Math.round((mins / 60) * a.staff.payRate)
        : a.staff.payType === "PER_JOB" ? a.staff.payRate
        : Math.round((j.revenueCents * a.staff.payRate) / 10000);
      labour += c;
      if (estimated && a.staff.payType === "HOURLY") anyEstimated = true;
      breakdown.push({
        staff: a.staff.name, minutes: Math.round(mins), costCents: c,
        payType: a.staff.payType,
        estimated: estimated && a.staff.payType === "HOURLY",
        // A cleaner on a zero pay rate contributes nothing to labour, which
        // looks like a costing fault but is an unset rate on the staff record.
        noRate: a.staff.payRate === 0,
      });
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
      labourEstimated: anyEstimated,
      staffWithoutRate: breakdown.filter((b) => b.noRate).map((b) => b.staff),
    };
  },
});

// Calendar move updates the date and full team as one operation.
defineAction({
  name: "jobs.move", description: "Move a job and assign its complete cleaner team together.",
  category: "Jobs", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ jobId: z.string(), scheduledAt: z.string(), staffIds: z.array(z.string()) }),
  handler: async ({ jobId, scheduledAt, staffIds }) => scheduleWrite(async (db) => {
    const j = await db.job.findUnique({ where: { id: jobId } });
    if (!j) throw new ActionError("Job not found");
    if (["COMPLETED", "CANCELLED"].includes(j.status)) throw new ActionError("Reopen this job before moving it.");
    const when = new Date(scheduledAt);
    await assertAvailable(db, staffIds, when, j.durationMin, jobId);
    await db.jobAssignment.deleteMany({ where: { jobId } });
    if (staffIds.length) await db.jobAssignment.createMany({ data: staffIds.map((staffId, n) => ({ jobId, staffId, isLead: n === 0 })) });
    if (j.bookingId) await db.booking.update({ where: { id: j.bookingId }, data: { startAt: when } });
    await notify({ type: "SCHEDULE_CHANGE", title: `Job ${j.ref} moved`, link: `/jobs/${jobId}` }, db);
    return db.job.update({ where: { id: jobId }, data: { scheduledAt: when } });
  }),
});
