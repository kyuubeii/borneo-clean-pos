import { availability } from "../scheduling";
import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";
import { assertOwnJob, assertSelf } from "../access";
import { startOfDay, endOfDay } from "../dates";

defineAction({
  name: "staff.list",
  description: "List cleaners and staff with their pay setup and contact details.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  handler: async ({ includeInactive }, ctx) => {
    const rows = await db.staff.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" }, include: { availability: true },
    });
    // A cleaner sees who their colleagues are -- name and colour, for the
    // calendar -- but not their pay, phone, email or notes.
    if (ctx.user.role !== "STAFF") return rows;
    return rows.map((s) => s.id === ctx.user.staffId ? s
      : { id: s.id, name: s.name, colour: s.colour, active: s.active, userId: s.userId, availability: [] });
  },
});

defineAction({
  name: "staff.create",
  description: "Add a new cleaner or staff member.",
  category: "Staff", roles: ["OWNER", "ADMIN"],
  input: z.object({ name: z.string().min(1), phone: z.string().optional(), email: z.string().optional(),
    payType: z.enum(["HOURLY", "PER_JOB", "PERCENT"]).default("HOURLY"),
    payRate: z.number().int().min(0).default(0).describe("Cents per hour, cents per job, or percent times 100"),
    colour: z.string().default("#3385fb"), notes: z.string().optional() }),
  handler: async (i) => db.staff.create({ data: i }),
});

defineAction({
  name: "staff.update",
  description: "Update a staff member's details, pay rate or active status.",
  category: "Staff", roles: ["OWNER", "ADMIN"],
  input: z.object({ staffId: z.string(), name: z.string().optional(), phone: z.string().optional(),
    email: z.string().optional(), payType: z.enum(["HOURLY", "PER_JOB", "PERCENT"]).optional(),
    payRate: z.number().int().optional(), active: z.boolean().optional(), notes: z.string().optional(),
    // Zod strips unknown keys rather than rejecting them, so without this the
    // edit form's colour change was accepted, reported as saved, and dropped.
    colour: z.string().optional().describe("Hex colour used on the calendar") }),
  handler: async ({ staffId, ...data }) => db.staff.update({ where: { id: staffId }, data }),
});

defineAction({
  name: "staff.setAvailability",
  description: "Replace a staff member's weekly working hours. Weekday 0 is Sunday.",
  category: "Staff", roles: ["OWNER", "ADMIN"],
  input: z.object({ staffId: z.string(), slots: z.array(z.object({
    weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440),
  })) }),
  handler: async ({ staffId, slots }) => {
    await db.availability.deleteMany({ where: { staffId } });
    if (slots.length) await db.availability.createMany({ data: slots.map((s) => ({ ...s, staffId })) });
    return db.staff.findUnique({ where: { id: staffId }, include: { availability: true } });
  },
});

defineAction({
  name: "staff.findAvailable",
  description: "Find which cleaners are free for a given date/time and duration, checking both their weekly availability and existing job assignments. Use before assigning a cleaner.",
  category: "Staff", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ startAt: z.string().describe("ISO datetime"), durationMin: z.number().int().default(120), excludeJobId: z.string().optional() }),
  handler: async ({ startAt, durationMin, excludeJobId }) => availability(db, new Date(startAt), durationMin, excludeJobId),
});

defineAction({
  name: "staff.checkIn",
  description: "Check a cleaner in to a job, starting their time tracking.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), staffId: z.string() }),
  handler: async ({ jobId, staffId }, ctx) => {
    assertSelf(ctx, staffId);
    await assertOwnJob(ctx, jobId);
    const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job) throw new ActionError("Job not found");
    // Checking in used to set the job in progress whatever it was, which
    // quietly reopened a cancelled or finished job.
    if (["COMPLETED", "CANCELLED"].includes(job.status)) throw new ActionError("This job is closed, so there is nothing to check in to.");
    const open = await db.timeEntry.findFirst({ where: { jobId, staffId, endAt: null } });
    if (open) throw new ActionError("Already checked in to this job");
    await db.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
    return db.timeEntry.create({ data: { jobId, staffId, startAt: new Date() } });
  },
});

defineAction({
  name: "staff.checkOut",
  description: "Check a cleaner out of a job, closing their open time entry.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), staffId: z.string(), note: z.string().optional() }),
  handler: async ({ jobId, staffId, note }, ctx) => {
    assertSelf(ctx, staffId);
    const open = await db.timeEntry.findFirst({ where: { jobId, staffId, endAt: null }, orderBy: { startAt: "desc" } });
    if (!open) throw new ActionError("No open check-in found for this cleaner on this job");
    // A check-out seconds after the check-in is a mis-tap, not work. Storing it
    // would cost the job a stray cent or two of labour and, worse, look like
    // real tracked time -- so the costing would trust it over the scheduled
    // duration. The entry is dropped instead, leaving nothing to unpick.
    const minutes = (Date.now() - open.startAt.getTime()) / 60000;
    if (minutes < 1) {
      await db.timeEntry.delete({ where: { id: open.id } });
      return { removed: true, message: "Check-in cancelled — under a minute, so no time was recorded." };
    }
    return db.timeEntry.update({ where: { id: open.id }, data: { endAt: new Date(), note } });
  },
});

defineAction({
  name: "staff.workHistory",
  description: "Get a cleaner's completed jobs, hours worked and performance over a period.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ staffId: z.string(), from: z.string().optional(), to: z.string().optional() }),
  handler: async ({ staffId, from, to }, ctx) => {
    assertSelf(ctx, staffId);
    const gte = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const lte = to ? new Date(to) : new Date();
    const entries = await db.timeEntry.findMany({ where: { staffId, startAt: { gte, lte } }, include: { job: true } });
    const minutes = entries.reduce((a, e) => a + (e.endAt ? (e.endAt.getTime() - e.startAt.getTime()) / 60000 : 0), 0);
    const jobs = await db.job.findMany({ where: { assignments: { some: { staffId } }, scheduledAt: { gte, lte } }, include: { customer: true } });
    return {
      totalMinutes: Math.round(minutes), totalHours: +(minutes / 60).toFixed(2),
      jobsAssigned: jobs.length, jobsCompleted: jobs.filter((j) => j.status === "COMPLETED").length,
      jobs: jobs.map((j) => ({ id: j.id, ref: j.ref, customer: j.customer.name, status: j.status, scheduledAt: j.scheduledAt })),
    };
  },
});
