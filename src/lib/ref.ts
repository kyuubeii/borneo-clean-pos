import { db } from "./db";

/**
 * Sequential human-friendly reference, e.g. INV-0042.
 *
 * Derived from the highest reference in use, never from a row count. Counting
 * breaks permanently the first time anything is deleted: the count drops below
 * the highest ref still on a row, so the next create regenerates a reference
 * that already exists, `ref @unique` throws P2002, and nothing ever advances
 * the counter again. Refs are a prefix and a zero-padded 4-digit number, so ordering one
 * prefix's refs descending gives the highest in use.
 */
export async function nextRef(prefix: string, model: "booking"|"job"|"invoice"|"quote"|"payment"|"expense"|"payout", client: any = db) {
  // Only this prefix: payouts hold both PO- and RMB- refs, and "RMB" sorts above
  // "PO", so the highest ref overall would hand out the same PO number twice.
  const last = await client[model].findFirst({ where: { ref: { startsWith: `${prefix}-` } }, orderBy: { ref: "desc" }, select: { ref: true } });
  const highest = last ? parseInt(String(last.ref).split("-")[1] ?? "0", 10) : 0;
  return `${prefix}-${String((Number.isFinite(highest) ? highest : 0) + 1).padStart(4, "0")}`;
}
