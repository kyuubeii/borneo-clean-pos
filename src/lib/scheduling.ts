import { notify } from "./notify";
import { db } from "./db";
import { ActionError } from "./registry";

/** Serialize conflicting schedule writes with retry, without changing the schema. */
export async function scheduleWrite<T>(work: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", timeout: 30000 }); }
    catch (e: any) {
      if (e.code !== "P2034" || attempt >= 2) throw e;
    }
  }
}

export function validSlot(start: Date, duration: number) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(duration) || duration <= 0)
    throw new ActionError("Choose a valid date, time and duration.");
}

export function slotReason(staff: any, jobs: any[], start: Date, duration: number): string | null {
  validSlot(start, duration);
  // Business hours are in Malaysia, regardless of the server's timezone.
  const local = new Date(start.getTime() + 8 * 3600000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const slots = staff.availability.filter((a: any) => a.weekday === local.getUTCDay());
  if (staff.availability.length && !slots.some((a: any) => mins >= a.startMin && mins + duration <= a.endMin))
    return "Outside working hours";
  const end = start.getTime() + duration * 60000;
  const clash = jobs.find((j: any) => j.assignments.some((a: any) => a.staffId === staff.id)
    && j.scheduledAt.getTime() < end && j.scheduledAt.getTime() + j.durationMin * 60000 > start.getTime());
  return clash ? `Already on job ${clash.ref}` : null;
}

export async function availability(client: any, start: Date, duration: number, excludeJobId?: string) {
  validSlot(start, duration);
  const staff = await client.staff.findMany({ where: { active: true }, include: { availability: true } });
  // Include overnight work that started before this day.
  const jobs = await client.job.findMany({ where: {
    status: { notIn: ["CANCELLED"] },
    ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    scheduledAt: { lt: new Date(start.getTime() + duration * 60000) },
    assignments: { some: {} },
  }, include: { assignments: true } });
  return staff.map((s: any) => {
    const reason = slotReason(s, jobs, start, duration);
    return { staffId: s.id, name: s.name, available: !reason, reason: reason ?? "Free" };
  });
}

export async function assertAvailable(client: any, ids: string[], start: Date, duration: number, excludeJobId?: string) {
  validSlot(start, duration);
  if (!ids.length) return;
  if (new Set(ids).size !== ids.length) throw new ActionError("Choose each cleaner only once.");
  const rows = await availability(client, start, duration, excludeJobId);
  for (const id of ids) {
    const row = rows.find((r: any) => r.staffId === id);
    if (!row) throw new ActionError("One of the selected cleaners is no longer active. Refresh and choose again.");
    if (!row.available) throw new ActionError(`${row.name}: ${row.reason}. Choose another cleaner or time.`);
  }
}

/** Both entry points share completion, cancellation and reopening behavior. */
export async function setJobStatus(client: any, jobId: string, status: string, bookingStatus?: string) {
  const job = await client.job.findUnique({ where: { id: jobId }, include: { assignments: true } });
  if (!job) throw new ActionError("Job not found");
  if (!["CANCELLED", "COMPLETED"].includes(status) && ["CANCELLED", "COMPLETED"].includes(job.status))
    await assertAvailable(client, job.assignments.map((a: any) => a.staffId), job.scheduledAt, job.durationMin, jobId);
  const now = new Date();
  if (["COMPLETED", "CANCELLED"].includes(status))
    await client.timeEntry.updateMany({ where: { jobId, endAt: null }, data: { endAt: now } });
  if (job.bookingId) await client.booking.update({ where: { id: job.bookingId }, data: {
    status: bookingStatus ?? (status === "COMPLETED" || status === "CANCELLED" ? status : "CONFIRMED"),
    ...(status !== "CANCELLED" ? { cancelReason: null } : {}),
  } });
  if (status === "COMPLETED" && job.status !== "COMPLETED") await notify({ type: "JOB_COMPLETED", title: `Job ${job.ref} completed`, link: `/jobs/${jobId}` }, client);
  return client.job.update({ where: { id: jobId }, data: {
    status, completedAt: status === "COMPLETED" ? job.completedAt ?? now : null,
  } });
}
