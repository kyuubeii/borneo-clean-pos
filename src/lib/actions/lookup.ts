import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";

const PREFIX: Record<string, string> = {
  BKG: "booking", JOB: "job", INV: "invoice", QT: "quote", PAY: "payment", EXP: "expense", PO: "payout",
};

defineAction({
  name: "lookup.byRef",
  description: "Find any record by its reference code (BKG-0184, JOB-0137, INV-0042, QT-0001, PAY-0100, EXP-0012, PO-0001). Always use this when the user mentions a reference code — never scan lists looking for one.",
  category: "Lookup", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ ref: z.string().describe("Reference code, e.g. BKG-0184. Case-insensitive.") }),
  handler: async ({ ref }, ctx) => {
    const clean = ref.trim().toUpperCase();
    const prefix = clean.split("-")[0];
    const model = PREFIX[prefix];
    if (!model) throw new ActionError(`Unrecognised reference "${ref}". Expected one of: ${Object.keys(PREFIX).join(", ")}.`);

    const include: Record<string, unknown> = {
      booking: { customer: true, address: true, items: true, job: true },
      job: { customer: true, address: true, assignments: { include: { staff: true } }, checklist: true, invoice: true },
      invoice: { customer: true, items: true, payments: true },
      quote: { customer: true, items: true },
      payment: { customer: true, invoice: true },
      expense: { category: true, job: true, staff: true },
      payout: { staff: true },
    };
    const row = await (db as any)[model].findUnique({ where: { ref: clean }, include: include[model] });
    if (!row) throw new ActionError(`No ${model} found with reference ${clean}`);

    // Cleaners may only look up their own jobs.
    if (ctx.user.role === "STAFF" && model === "job" &&
        !row.assignments?.some((a: any) => a.staffId === ctx.user.staffId)) {
      throw new ActionError("You are not assigned to this job");
    }
    if (ctx.user.role === "STAFF" && model !== "job") {
      throw new ActionError(`Your role cannot look up ${model} records`);
    }
    return { type: model, record: row };
  },
});

defineAction({
  name: "search.global",
  description: "Search across customers, bookings, jobs, invoices and quotes at once with free text. Use when you are not sure which kind of record the user means.",
  category: "Lookup", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ query: z.string().min(1), limit: z.number().int().max(20).default(5) }),
  handler: async ({ query, limit }) => {
    const [customers, bookings, jobs, invoices, quotes] = await Promise.all([
      db.customer.findMany({ where: { OR: [{ name: { contains: query, mode: "insensitive" as const } }, { phone: { contains: query, mode: "insensitive" as const } }, { email: { contains: query, mode: "insensitive" as const } }, { company: { contains: query, mode: "insensitive" as const } }] }, take: limit }),
      db.booking.findMany({ where: { OR: [{ ref: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] }, take: limit, include: { customer: true }, orderBy: { startAt: "desc" } }),
      db.job.findMany({ where: { OR: [{ ref: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] }, take: limit, include: { customer: true }, orderBy: { scheduledAt: "desc" } }),
      db.invoice.findMany({ where: { OR: [{ ref: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] }, take: limit, include: { customer: true }, orderBy: { issuedAt: "desc" } }),
      db.quote.findMany({ where: { OR: [{ ref: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] }, take: limit, include: { customer: true } }),
    ]);
    return {
      customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      bookings: bookings.map((b) => ({ id: b.id, ref: b.ref, customer: b.customer.name, startAt: b.startAt, status: b.status })),
      jobs: jobs.map((j) => ({ id: j.id, ref: j.ref, customer: j.customer.name, scheduledAt: j.scheduledAt, status: j.status })),
      invoices: invoices.map((i) => ({ id: i.id, ref: i.ref, customer: i.customer.name, status: i.status })),
      quotes: quotes.map((q) => ({ id: q.id, ref: q.ref, customer: q.customer.name, status: q.status })),
    };
  },
});
