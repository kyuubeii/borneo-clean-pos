/**
 * What one cleaner costs on one job.
 *
 * Job costing, payroll and the reports all call this, so the figure on a job
 * page is the figure payroll pays and the figure the P&L deducts. They used to
 * each carry their own copy of the formula, and the copies had drifted.
 *
 * An amount set by hand on the job wins. Otherwise it comes from the cleaner's
 * pay basis: hourly on tracked time (or the scheduled duration once the job is
 * done and nothing usable was tracked), a flat rate per job, or a share of the
 * job's value.
 */
export type LabourJob = { status: string; durationMin: number; revenueCents: number };
export type LabourAssignment = { staffId: string; labourCents?: number | null; staff: { payType: string; payRate: number } };
export type LabourEntry = { staffId: string; startAt: Date; endAt: Date | null };

export type LabourLine = {
  minutes: number;
  costCents: number;
  /** The amount was typed in on the job rather than worked out. */
  fixed: boolean;
  /** Hourly pay estimated from the scheduled duration, since nothing was tracked. */
  estimated: boolean;
  /** No manual amount and no pay rate on the staff record, so it costs nothing. */
  noRate: boolean;
};

export function labourFor(job: LabourJob, a: LabourAssignment, entries: LabourEntry[]): LabourLine {
  const tracked = entries.filter((t) => t.staffId === a.staffId)
    .reduce((x, t) => x + (t.endAt ? (t.endAt.getTime() - t.startAt.getTime()) / 60000 : 0), 0);
  // A check-in closed seconds after it was opened is a mis-tap, not work.
  // Anything under a minute is treated as untracked, so a completed job
  // falls back to its scheduled duration instead of costing a stray cent.
  const useTracked = tracked >= 1;
  const hourly = a.staff.payType === "HOURLY";
  const estimated = hourly && !useTracked && job.status === "COMPLETED";
  const minutes = Math.round(useTracked ? tracked : estimated ? job.durationMin : 0);

  if (a.labourCents != null) {
    return { minutes, costCents: a.labourCents, fixed: true, estimated: false, noRate: false };
  }
  const costCents = hourly ? Math.round((minutes / 60) * a.staff.payRate)
    : a.staff.payType === "PER_JOB" ? a.staff.payRate
    : Math.round((job.revenueCents * a.staff.payRate) / 10000);
  return { minutes, costCents, fixed: false, estimated, noRate: a.staff.payRate === 0 };
}

/** Total labour on a job across every assigned cleaner. */
export function jobLabour(job: LabourJob & { assignments: LabourAssignment[]; timeEntries: LabourEntry[] }) {
  return job.assignments.reduce((x, a) => x + labourFor(job, a, job.timeEntries).costCents, 0);
}
