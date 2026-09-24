import { z } from "zod";
import { db } from "../db";
import { totals } from "../money";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { nextRef } from "../ref";
import { startOfDay, endOfDay, addDays, addMonths, fmtStamp } from "../dates";
import { assertAvailable, scheduleWrite, setJobStatus } from "../scheduling";
import { notify } from "../notify";


async function withQuotedAmounts(rows: any[]) {
  const ids = rows.map(b => b.quoteId).filter(Boolean);
  if (!ids.length) return rows;
  const quotes = await db.quote.findMany({ where: { id: { in: ids } }, include: { items: true } });
  return rows.map(b => {
    const q = quotes.find(q => q.id === b.quoteId);
    return q ? { ...b, items: q.items, totalCents: totals(q.items, q.discountCents, q.taxRateBp).total,
      discountCents: q.discountCents, taxRateBp: q.taxRateBp } : b;
  });
}

/** Expand a recurrence rule into concrete dates, capped so we never generate forever. */
function occurrences(start: Date, rule: string, until: Date | null): Date[] {
  const out: Date[] = [];
  const cap = until ?? addMonths(start, 6);
  let d = new Date(start);
  for (let i = 0; i < 200; i++) {
    d = rule === "WEEKLY" ? addDays(d, 7) : rule === "FORTNIGHTLY" ? addDays(d, 14) : addMonths(d, 1);
    if (d > cap) break;
    out.push(new Date(d));
  }
  return out;
}

async function createJobForBooking(bookingId: string, db: any) {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { items: { include: { service: true } } } });
  if (!b) return null;
  const revenue = b.items.reduce((a: number, i: any) => a + i.qty * i.priceCents, 0);
  const material = b.items.reduce((a: number, i: any) => a + i.qty * i.service.materialCostCents, 0);
  return db.job.create({
    data: {
      ref: await nextRef("JOB", "job", db), bookingId: b.id, customerId: b.customerId, addressId: b.addressId,
      scheduledAt: b.startAt, durationMin: b.durationMin, customerInstructions: b.notes,
      internalNotes: b.internalNotes, revenueCents: revenue, materialCostCents: material,
      checklist: { create: b.items.map((i: any, n: number) => ({ label: i.name, sort: n })) },
    },
  });
}

defineAction({
  name: "bookings.list",
  description: "List bookings, filtered by date range, status or customer. Use for questions about upcoming or past bookings.",
  category: "Bookings", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({
    from: z.string().optional().describe("ISO date, inclusive"), to: z.string().optional(),
    status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
    query: z.string().optional(), offset: z.number().int().min(0).default(0),
    direction: z.enum(["asc", "desc"]).default("asc"),
    customerId: optionalId(), limit: z.number().int().max(100).default(50),
  }),
  handler: async ({ from, to, status, customerId, limit, query, offset, direction }) => withQuotedAmounts(await db.booking.findMany({
    where: {
      ...(query ? { OR: [{ ref: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] } : {}),
      ...(status ? { status } : {}), ...(customerId ? { customerId } : {}),
      ...(from || to ? { startAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}),
    },
    orderBy: [{ startAt: direction }, { id: direction }], skip: offset, take: limit,
    include: { customer: true, address: true, items: true, job: true },
  })),
});

defineAction({
  name: "bookings.get",
  description: "Get one booking in full, with its customer, address, services and linked job.",
  category: "Bookings", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ bookingId: z.string() }),
  handler: async ({ bookingId }) => {
    const b = await db.booking.findUnique({ where: { id: bookingId },
      include: { customer: true, address: true, items: true, job: true, children: true, parent: true } });
    if (!b) throw new ActionError("Booking not found");
    return (await withQuotedAmounts([b]))[0];
  },
});

defineAction({
  name: "bookings.create",
  description: "Create a booking for a customer with one or more services, and generate the matching job. Supports recurring bookings. Use for requests like 'book John for a deep clean next Tuesday at 2pm'.",
  category: "Bookings", roles: ["OWNER", "ADMIN"],
  input: z.object({
    customerId: z.string(),
    addressId: optionalId(),
    startAt: z.string().describe("ISO datetime for the first visit"),
    serviceIds: z.array(z.string()).min(1).describe("Service catalogue IDs; look them up with services.list"),
    notes: z.string().optional().describe("Instructions visible to the customer and cleaner"),
    internalNotes: z.string().optional(),
    recurrence: z.enum(["NONE", "WEEKLY", "FORTNIGHTLY", "MONTHLY"]).default("NONE"),
    recurUntil: z.string().optional().describe("ISO date to stop repeating"),
    staffIds: z.array(z.string()).optional().describe("Cleaners to assign immediately"),
  }),
  handler: async (i, ctx) => {
    return scheduleWrite(async (db) => {
    const customer = await db.customer.findUnique({ where: { id: i.customerId }, include: { addresses: true } });
    if (!customer) throw new ActionError("Customer not found");
    const services = await db.service.findMany({ where: { id: { in: i.serviceIds } } });
    if (services.length !== i.serviceIds.length) throw new ActionError("One or more services not found");
    const addressId = i.addressId ?? customer.addresses.find((a: any) => a.isPrimary)?.id ?? customer.addresses[0]?.id;
    const duration = services.reduce((a: number, s: any) => a + s.durationMin, 0) || 120;
    const start = new Date(i.startAt);
    if (i.recurUntil && (!Number.isFinite(new Date(i.recurUntil).getTime()) || new Date(i.recurUntil) < start)) throw new ActionError("Repeat until must be on or after the first visit.");

    const make = async (when: Date, parentId?: string) => {
      await assertAvailable(db, i.staffIds ?? [], when, duration);
      const b = await db.booking.create({
        data: {
          ref: await nextRef("BKG", "booking", db), customerId: i.customerId, addressId,
          startAt: when, durationMin: duration, notes: i.notes, internalNotes: i.internalNotes,
          source: ctx.source === "assistant" ? "ASSISTANT" : "ADMIN",
          recurrence: parentId ? "NONE" : i.recurrence,
          recurUntil: i.recurUntil && !parentId ? new Date(i.recurUntil) : null,
          parentId,
          items: { create: services.map((s: any) => ({ serviceId: s.id, qty: 1, priceCents: s.priceCents, name: s.name })) },
        },
      });
      const job = await createJobForBooking(b.id, db);
      if (job && i.staffIds?.length) {
        await db.jobAssignment.createMany({ data: i.staffIds.map((sid, n) => ({ jobId: job.id, staffId: sid, isLead: n === 0 })) });
      }
      return { booking: b, job };
    };

    const first = await make(start);
    const extra: string[] = [];
    if (i.recurrence !== "NONE") {
      for (const when of occurrences(start, i.recurrence, i.recurUntil ? new Date(i.recurUntil) : null)) {
        const r = await make(when, first.booking.id);
        extra.push(r.booking.ref);
      }
    }
    await notify({ type: "BOOKING_CONFIRMED", title: `Booking ${first.booking.ref} confirmed`,
      body: `${customer.name} · ${fmtStamp(start)}`, link: `/bookings/${first.booking.id}` }, db);
    return { booking: first.booking, jobRef: first.job?.ref, recurringCreated: extra.length, recurringRefs: extra,
      total: services.reduce((a: number, s: any) => a + s.priceCents, 0) };
    });
  },
});

defineAction({
  name: "bookings.reschedule",
  description: "Move a single booking (and its job) to a new date/time. Only affects that one occurrence, never the whole recurring series.",
  category: "Bookings", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ bookingId: z.string(), startAt: z.string().describe("New ISO datetime"), reason: z.string().optional() }),
  handler: async ({ bookingId, startAt, reason }) => scheduleWrite(async (db) => {
    const b = await db.booking.findUnique({ where: { id: bookingId }, include: { job: { include: { assignments: true } }, customer: true } });
    if (!b) throw new ActionError("Booking not found");
    const when = new Date(startAt);
    await assertAvailable(db, b.job?.assignments.map((a: any) => a.staffId) ?? [], when, b.durationMin, b.job?.id);
    const updated = await db.booking.update({ where: { id: bookingId }, data: { startAt: when } });
    if (b.job) await db.job.update({ where: { id: b.job.id }, data: { scheduledAt: when } });
    await notify({ type: "SCHEDULE_CHANGE", title: `Booking ${b.ref} moved`,
      body: `${b.customer.name} → ${fmtStamp(when)}${reason ? ` (${reason})` : ""}`, link: `/bookings/${bookingId}` }, db);
    return { ref: b.ref, from: b.startAt, to: updated.startAt };
  }),
});

defineAction({
  name: "bookings.cancel",
  description: "Cancel a booking and its job. Optionally cancel the remaining future occurrences of a recurring series too.",
  category: "Bookings", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ bookingId: z.string(), reason: z.string().optional(), wholeSeries: z.boolean().default(false) }),
  handler: async ({ bookingId, reason, wholeSeries }) => scheduleWrite(async (db) => {
    const b = await db.booking.findUnique({ where: { id: bookingId }, include: { customer: true } });
    if (!b) throw new ActionError("Booking not found");
    const ids = [bookingId];
    if (wholeSeries) {
      const rootId = b.parentId ?? b.id;
      const kin = await db.booking.findMany({ where: { OR: [{ id: rootId }, { parentId: rootId }], startAt: { gte: new Date() }, status: { not: "CANCELLED" } } });
      ids.push(...kin.map((k: any) => k.id));
    }
    const unique = [...new Set(ids)];
    await db.booking.updateMany({ where: { id: { in: unique } }, data: { status: "CANCELLED", cancelReason: reason } });
    const jobs = await db.job.findMany({ where: { bookingId: { in: unique } } });
    for (const job of jobs) await setJobStatus(db, job.id, "CANCELLED");
    await notify({ type: "SCHEDULE_CHANGE", title: `Booking ${b.ref} cancelled`, body: `${b.customer.name}${reason ? ` · ${reason}` : ""}` }, db);
    return { cancelled: unique.length, refs: b.ref };
  }),
});

defineAction({
  name: "bookings.updateStatus",
  description: "Change a booking's status (PENDING, CONFIRMED, COMPLETED).",
  category: "Bookings", roles: ["OWNER", "ADMIN"],
  input: z.object({ bookingId: z.string(), status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]) }),
  handler: async ({ bookingId, status }) => scheduleWrite(async (db) => {
    const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { job: true } });
    if (!booking) throw new ActionError("Booking not found");
    if (booking.job) await setJobStatus(db, booking.job.id, status === "CANCELLED" || status === "COMPLETED" ? status : (["EN_ROUTE", "IN_PROGRESS"].includes(booking.job.status) ? booking.job.status : "SCHEDULED"), status);
    return db.booking.update({ where: { id: bookingId }, data: { status } });
  }),
});
