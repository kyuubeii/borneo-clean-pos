import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";
import { startOfDay, endOfDay } from "../dates";

defineAction({
  name: "staff.list",
  description: "List cleaners and staff with their pay setup and contact details.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  handler: async ({ includeInactive }) => db.staff.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" }, include: { availability: true },
  }),
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
    payRate: z.number().int().optional(), active: z.boolean().optional(), notes: z.string().optional() }),
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
  input: z.object({ startAt: z.string().describe("ISO datetime"), durationMin: z.number().int().default(120) }),
  handler: async ({ startAt, durationMin }) => {
    const start = new Date(startAt);
    const end = new Date(start.getTime() + durationMin * 60000);
    const mins = start.getHours() * 60 + start.getMinutes();
    const endMins = mins + durationMin;
    const staff = await db.staff.findMany({ where: { active: true }, include: { availability: true } });
    const jobs = await db.job.findMany({
      where: { status: { notIn: ["CANCELLED"] }, scheduledAt: { gte: startOfDay(start), lte: endOfDay(start) } },
      include: { assignments: true },
    });
    return staff.map((s) => {
      const avail = s.availability.filter((a) => a.weekday === start.getDay());
      const worksThen = avail.length === 0 ? true : avail.some((a) => mins >= a.startMin && endMins <= a.endMin);
      const clash = jobs.find((j) => {
        if (!j.assignments.some((a) => a.staffId === s.id)) return false;
        const js = j.scheduledAt.getTime(), je = js + j.durationMin * 60000;
        return js < end.getTime() && je > start.getTime();
      });
      return { staffId: s.id, name: s.name, available: worksThen && !clash,
        reason: clash ? `Already on job ${clash.ref}` : !worksThen ? "Outside working hours" : "Free" };
    });
  },
});

defineAction({
  name: "staff.checkIn",
  description: "Check a cleaner in to a job, starting their time tracking.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), staffId: z.string() }),
  handler: async ({ jobId, staffId }) => {
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
  handler: async ({ jobId, staffId, note }) => {
    const open = await db.timeEntry.findFirst({ where: { jobId, staffId, endAt: null }, orderBy: { startAt: "desc" } });
    if (!open) throw new ActionError("No open check-in found for this cleaner on this job");
    return db.timeEntry.update({ where: { id: open.id }, data: { endAt: new Date(), note } });
  },
});

defineAction({
  name: "staff.workHistory",
  description: "Get a cleaner's completed jobs, hours worked and performance over a period.",
  category: "Staff", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ staffId: z.string(), from: z.string().optional(), to: z.string().optional() }),
  handler: async ({ staffId, from, to }) => {
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
