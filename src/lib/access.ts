import { db } from "./db";
import { ActionError, type ActionCtx } from "./registry";

/**
 * What a cleaner may touch. The role check in the registry only says a cleaner
 * may call an action at all; these say on whose behalf and on which job. An
 * owner or admin passes straight through.
 */

/** A cleaner may only act on a job they are assigned to. */
export async function assertOwnJob(ctx: ActionCtx, jobId: string, client: any = db) {
  if (ctx.user.role !== "STAFF") return;
  const mine = ctx.user.staffId
    ? await client.jobAssignment.findFirst({ where: { jobId, staffId: ctx.user.staffId }, select: { id: true } })
    : null;
  if (!mine) throw new ActionError("You can only change jobs you are assigned to.");
}

/** A cleaner may only act as themselves. */
export function assertSelf(ctx: ActionCtx, staffId: string) {
  if (ctx.user.role === "STAFF" && staffId !== ctx.user.staffId) throw new ActionError("You can only do this for yourself.");
}

/**
 * The statuses a cleaner moves their own job through: on the way, in
 * progress, done. Cancelling, re-scheduling and reopening are office decisions
 * -- cancelling also voids the invoice.
 */
export const STAFF_STATUSES = ["EN_ROUTE", "IN_PROGRESS", "COMPLETED"];
