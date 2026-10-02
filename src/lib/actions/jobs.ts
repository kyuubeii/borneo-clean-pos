import { assertAvailable, scheduleWrite, setJobStatus, setJobTeam } from "../scheduling";
import { labourFor } from "../labour";
import { nextRef } from "../ref";
import { z } from "zod";
import { db } from "../db";
import { optionalId, optionalText, nullableId, clearableText } from "../schema";
import { defineAction, ActionError } from "../registry";
import { startOfDay, endOfDay, fmtStamp } from "../dates";
import { notify } from "../notify";
import { isUploadedFileUrl } from "../storage";
import { assertOwnJob, STAFF_STATUSES } from "../access";

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
    if (ctx.user.role !== "STAFF") return j;
    // A cleaner sees who they work with and what the job is charged at (they
    // may be collecting it), but not what anyone is paid, nor the invoice and
    // the expenses booked against the job: those stay with the office.
    const person = (s: any) => s && ({ id: s.id, name: s.name, colour: s.colour });
    const x: any = j;
    return { ...x, expenses: [], invoice: null,
      assignments: x.assignments.map((a: any) => ({ ...a, labourCents: undefined, staff: person(a.staff) })),
      timeEntries: x.timeEntries.map((t: any) => ({ ...t, staff: person(t.staff) })) };
  },
});

defineAction({
  name: "jobs.updateStatus",
  description: "Change a job's status. Setting COMPLETED stamps the completion time and closes any open check-ins.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), status: z.enum(["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) }),
  handler: async ({ jobId, status }, ctx) => scheduleWrite(async (db) => {
    if (ctx.user.role === "STAFF") {
      await assertOwnJob(ctx, jobId, db);
      const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!STAFF_STATUSES.includes(status)) throw new ActionError("Only the office can cancel or reschedule a job.");
      if (job && ["COMPLETED", "CANCELLED"].includes(job.status)) throw new ActionError("This job is closed. Ask the office to reopen it.");
    }
    return setJobStatus(db, jobId, status);
  }),
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
    await notify({ type: "SCHEDULE_CHANGE", title: `Job ${j.ref} moved`, body: `${j.customer.name} → ${fmtStamp(when)}`, link: `/jobs/${jobId}` }, db);
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
    const added = await setJobTeam(db, jobId, staffIds);
    const staff = await db.staff.findMany({ where: { id: { in: staffIds } } });
    // Only people who are new to the job. Re-saving an unchanged team used to
    // announce everyone on it again, which is how the bell filled up.
    for (const s of staff.filter((x: any) => added.includes(x.id))) await notify({ type: "STAFF", title: `Assigned to job ${j.ref}`, body: s.name, link: `/jobs/${jobId}` }, db);
    return { jobRef: j.ref, assigned: staff.map((s: any) => s.name) };
  }),
});

defineAction({
  name: "jobs.update",
  description: "Update a job's instructions, internal notes, staff notes, duration or material cost. For labour or job expenses use jobs.updateCosting.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), customerInstructions: z.string().optional(),
    internalNotes: z.string().optional(), staffNotes: z.string().optional(),
    materialCostCents: z.number().int().min(0).optional(), durationMin: z.number().int().min(15).optional() }),
  handler: async ({ jobId, ...data }, ctx) => scheduleWrite(async (db) => {
    // Costing is money, and cleaners do not see job costing at all.
    if (ctx.user.role === "STAFF" && data.materialCostCents !== undefined) throw new ActionError("Only an owner or admin can change a job's costs.");
    // The length of a visit moves the schedule, which is the office's to change.
    if (ctx.user.role === "STAFF" && data.durationMin !== undefined) throw new ActionError("Only the office can change how long a job takes.");
    await assertOwnJob(ctx, jobId, db);
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
  handler: async ({ jobId, items }, ctx) => {
    await assertOwnJob(ctx, jobId);
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
  handler: async ({ itemId, done }, ctx) => {
    const item = await db.checklistItem.findUnique({ where: { id: itemId }, select: { jobId: true } });
    if (!item) throw new ActionError("That checklist item no longer exists. Refresh and try again.");
    await assertOwnJob(ctx, item.jobId);
    return db.checklistItem.update({ where: { id: itemId }, data: { done } });
  },
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
  handler: async (i, ctx) => {
    const job = await db.job.findUnique({ where: { id: i.jobId }, select: { id: true } });
    if (!job) throw new ActionError("Job not found");
    await assertOwnJob(ctx, i.jobId);
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
  description: "Full job costing: revenue, labour per cleaner (a fixed amount set on the job, otherwise from their pay rate), material cost, the expenses linked to the job, profit and margin.",
  category: "Job Costing", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ jobId: z.string() }),
  handler: async ({ jobId }) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: {
      customer: true, timeEntries: true,
      assignments: { include: { staff: true }, orderBy: { isLead: "desc" } },
      expenses: { include: { category: true, staff: true }, orderBy: { spentAt: "asc" } },
    } });
    if (!j) throw new ActionError("Job not found");
    const breakdown = j.assignments.map((a) => {
      const line = labourFor(j, a, j.timeEntries);
      return {
        staffId: a.staffId, staff: a.staff.name, payType: a.staff.payType, payRate: a.staff.payRate,
        minutes: line.minutes, costCents: line.costCents, fixed: line.fixed,
        // What the pay rate alone would give, so the editor can show it as the default.
        calculatedCents: labourFor(j, { ...a, labourCents: null }, j.timeEntries).costCents,
        estimated: line.estimated, noRate: line.noRate,
      };
    });
    const labour = breakdown.reduce((x, b) => x + b.costCents, 0);
    const other = j.expenses.reduce((a, e) => a + e.amountCents, 0);
    const cost = labour + j.materialCostCents + other;
    const profit = j.revenueCents - cost;
    return {
      jobRef: j.ref, customer: j.customer.name, status: j.status, scheduledAt: j.scheduledAt,
      revenueCents: j.revenueCents, labourCents: labour, materialCents: j.materialCostCents,
      otherExpenseCents: other, totalCostCents: cost, profitCents: profit,
      marginPct: j.revenueCents > 0 ? +((profit / j.revenueCents) * 100).toFixed(1) : 0,
      labourBreakdown: breakdown,
      labourEstimated: breakdown.some((b) => b.estimated),
      staffWithoutRate: breakdown.filter((b) => b.noRate).map((b) => b.staff),
      expenses: j.expenses.map((e) => ({
        id: e.id, ref: e.ref, amountCents: e.amountCents, spentAt: e.spentAt,
        category: e.category?.name ?? null, vendor: e.vendor, note: e.note,
        staffId: e.staffId, staff: e.staff?.name ?? null,
        reimbursable: e.reimbursable, reimbursed: e.reimbursed,
      })),
    };
  },
});

const costExpense = z.object({
  amountCents: z.number().int().min(1).describe("Amount in cents"),
  categoryName: optionalText().describe("e.g. Supplies, Fuel, Transport, Labour; created if new"),
  vendor: clearableText(), note: clearableText(),
  spentAt: z.string().optional().describe("ISO date; defaults to the job's date"),
  staffId: nullableId().describe("Cleaner who paid out of their own pocket. Null when it came out of business cash."),
  reimbursable: z.boolean().optional().describe("Owed back to that cleaner; defaults to true when a cleaner paid"),
});

defineAction({
  name: "jobs.updateCosting",
  description: "Edit a job's costing in one go: the labour amount paid to each cleaner for this job, the materials cost, and the expenses linked to the job (add, change or remove). Labour amounts flow into payroll and reports; the expenses appear in Expenses. A cleaner given a labour amount who is not yet on the job is added to it. Use labourCents null to go back to the cleaner's pay rate.",
  category: "Job Costing", roles: ["OWNER", "ADMIN"],
  input: z.object({
    jobId: z.string(),
    materialCostCents: z.number().int().min(0).optional(),
    labour: z.array(z.object({
      staffId: z.string(),
      labourCents: z.number().int().min(0).nullable().describe("What this cleaner is paid for this job, in cents. Null = use their pay rate."),
    })).optional(),
    addExpenses: z.array(costExpense).optional(),
    updateExpenses: z.array(costExpense.partial().extend({ expenseId: z.string() })).optional(),
    removeExpenseIds: z.array(z.string()).optional(),
  }),
  handler: async ({ jobId, materialCostCents, labour, addExpenses, updateExpenses, removeExpenseIds }) => scheduleWrite(async (db) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { assignments: true, expenses: true } });
    if (!j) throw new ActionError("Job not found");

    if (labour?.length) {
      const ids = labour.map((l) => l.staffId);
      if (new Set(ids).size !== ids.length) throw new ActionError("Each cleaner can only have one labour amount on a job.");
      const newcomers = ids.filter((id) => !j.assignments.some((a: any) => a.staffId === id));
      if (newcomers.length) {
        const found = await db.staff.count({ where: { id: { in: newcomers } } });
        if (found !== newcomers.length) throw new ActionError("One of those cleaners no longer exists. Refresh and try again.");
        // A finished job is history: paying someone for it must not depend on
        // whether they happen to be free at that time now.
        if (!["COMPLETED", "CANCELLED"].includes(j.status)) await assertAvailable(db, newcomers, j.scheduledAt, j.durationMin, jobId);
      }
      let hasLead = j.assignments.length > 0;
      for (const l of labour) {
        const existing = j.assignments.find((a: any) => a.staffId === l.staffId);
        if (existing) await db.jobAssignment.update({ where: { id: existing.id }, data: { labourCents: l.labourCents } });
        else {
          await db.jobAssignment.create({ data: { jobId, staffId: l.staffId, isLead: !hasLead, labourCents: l.labourCents } });
          hasLead = true;
        }
      }
    }

    if (materialCostCents !== undefined) await db.job.update({ where: { id: jobId }, data: { materialCostCents } });

    // The editor only ever touches this job's own expenses.
    const mine = (id: string) => {
      const e = j.expenses.find((x: any) => x.id === id);
      if (!e) throw new ActionError("That expense is not linked to this job. Refresh and try again.");
      return e;
    };
    const categoryId = async (name?: string | null) => name
      ? (await db.expenseCategory.upsert({ where: { name }, update: {}, create: { name } })).id : undefined;

    for (const id of removeExpenseIds ?? []) { mine(id); await db.expense.delete({ where: { id } }); }
    for (const { expenseId, categoryName, spentAt, staffId, ...rest } of updateExpenses ?? []) {
      const e = mine(expenseId);
      const cat = await categoryId(categoryName);
      // Same rule as expenses.update: a reimbursed tick recorded a repayment to
      // one person and cannot follow the row to someone else.
      const movedPayer = staffId !== undefined && staffId !== e.staffId;
      await db.expense.update({ where: { id: expenseId }, data: {
        ...rest, ...(cat ? { categoryId: cat } : {}),
        ...(spentAt ? { spentAt: new Date(spentAt) } : {}),
        ...(staffId === undefined ? {} : { staffId, reimbursable: rest.reimbursable ?? !!staffId }),
        ...(movedPayer ? { reimbursed: false } : {}),
      } });
    }
    for (const x of addExpenses ?? []) {
      await db.expense.create({ data: {
        ref: await nextRef("EXP", "expense", db), jobId, amountCents: x.amountCents,
        categoryId: await categoryId(x.categoryName), vendor: x.vendor ?? null, note: x.note ?? null,
        spentAt: x.spentAt ? new Date(x.spentAt) : j.scheduledAt,
        staffId: x.staffId ?? null, reimbursable: x.reimbursable ?? !!x.staffId,
      } });
    }
    return { jobRef: j.ref, saved: true };
  }),
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
    await setJobTeam(db, jobId, staffIds);
    if (j.bookingId) await db.booking.update({ where: { id: j.bookingId }, data: { startAt: when } });
    await notify({ type: "SCHEDULE_CHANGE", title: `Job ${j.ref} moved`, link: `/jobs/${jobId}` }, db);
    return db.job.update({ where: { id: jobId }, data: { scheduledAt: when } });
  }),
});
