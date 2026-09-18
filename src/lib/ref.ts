import { db } from "./db";
/** Sequential human-friendly reference, e.g. INV-0042. */
export async function nextRef(prefix: string, model: "booking"|"job"|"invoice"|"quote"|"payment"|"expense"|"payout") {
  const n = await (db as any)[model].count();
  return `${prefix}-${String(n + 1).padStart(4, "0")}`;
}
