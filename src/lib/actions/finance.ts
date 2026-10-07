import { scheduleWrite, validSlot } from "../scheduling";
import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { nextRef } from "../ref";
import { totals, syncInvoiceStatus as syncStatus } from "../money";
import { startOfDay, endOfDay, addDays, businessClock } from "../dates";
import { notify } from "../notify";

/** Invoice balance after payments and refunds. */
export function invoiceTotals(inv: { items: { qty: number; priceCents: number }[]; discountCents: number; taxRateBp: number; payments?: { amountCents: number; isRefund: boolean }[] }) {
  const t = totals(inv.items, inv.discountCents, inv.taxRateBp);
  const paid = (inv.payments ?? []).reduce((a, p) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
  return { ...t, paid, balance: t.total - paid };
}

async function syncInvoiceStatus(invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
  if (!inv || inv.status === "VOID" || inv.status === "DRAFT") return inv;
  const { total, paid } = invoiceTotals(inv);
  const status = paid <= 0 ? (inv.dueAt && inv.dueAt < new Date() ? "OVERDUE" : "SENT")
    : paid >= total ? "PAID" : "PARTIAL";
  return db.invoice.update({ where: { id: invoiceId }, data: { status } });
}

/* ---------------------------------- Quotes --------------------------------- */

defineAction({
  name: "quotes.list",
  description: "List quotations, optionally filtered by status or customer.",
  category: "Quotes", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ status: z.enum(["DRAFT","SENT","ACCEPTED","DECLINED","EXPIRED"]).optional(), customerId: optionalId(), limit: z.number().int().max(100).default(50) }),
  handler: async ({ status, customerId, limit }) => {
    const rows = await db.quote.findMany({ where: { ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) },
      orderBy: { issuedAt: "desc" }, take: limit, include: { customer: true, items: true } });
    return rows.map((q) => ({ id: q.id, ref: q.ref, customer: q.customer.name, status: q.status,
      convertedBookingId: q.convertedBookingId, convertedInvoiceId: q.convertedInvoiceId,
      issuedAt: q.issuedAt, validUntil: q.validUntil, ...totals(q.items, q.discountCents, q.taxRateBp) }));
  },
});

defineAction({
  name: "quotes.create",
  description: "Create a quotation for a customer with line items, an optional discount and tax rate.",
  category: "Quotes", roles: ["OWNER", "ADMIN"],
  input: z.object({
    customerId: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1).default(1),
      priceCents: z.number().int().describe("Unit price in cents"), serviceId: optionalId() })).min(1),
    discountCents: z.number().int().min(0).default(0), taxRateBp: z.number().int().min(0).default(0).describe("Tax rate in basis points; 600 is 6%"),
    validDays: z.number().int().default(30), notes: z.string().optional(),
  }),
  handler: async (i) => db.quote.create({
    data: { ref: await nextRef("QT", "quote"), customerId: i.customerId, discountCents: i.discountCents,
      taxRateBp: i.taxRateBp, notes: i.notes, validUntil: addDays(new Date(), i.validDays),
      items: { create: i.items } },
    include: { items: true, customer: true },
  }),
});

defineAction({
  name: "quotes.updateStatus",
  description: "Change a quote's status, e.g. mark it SENT, ACCEPTED or DECLINED.",
  category: "Quotes", roles: ["OWNER", "ADMIN"],
  input: z.object({ quoteId: z.string(), status: z.enum(["DRAFT","SENT","ACCEPTED","DECLINED","EXPIRED"]) }),
  handler: async ({ quoteId, status }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId } });
    if (!q) throw new ActionError("Quote not found");
    if (q.convertedBookingId) throw new ActionError("This quote is already booked. Open the linked booking.");
    if (q.convertedInvoiceId) throw new ActionError("This quote has already been invoiced. Open the linked invoice.");
    return db.quote.update({ where: { id: quoteId }, data: { status } });
  },
});

defineAction({
  name: "quotes.convertToBooking",
  description: "Turn a quote the customer has accepted into a booking and job at a given date/time. Use for 'they accepted the quote, book it for…'; the quote is marked accepted as part of this.",
  category: "Quotes", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ quoteId: z.string(), startAt: z.string().describe("ISO datetime for the visit") }),
  handler: async ({ quoteId, startAt }) => scheduleWrite(async (db) => {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { items: { include: { service: true } }, customer: { include: { addresses: true } } } });
    if (!q) throw new ActionError("Quote not found");
    // A deleted booking leaves this column pointing at nothing, since it is not
    // a foreign key. Only a booking that still exists should block a re-convert.
    if (q.convertedBookingId) {
      const prior = await db.booking.findUnique({ where: { id: q.convertedBookingId }, select: { ref: true } });
      if (prior) throw new ActionError(`This quote has already been converted into booking ${prior.ref}.`);
    }
    // Booking it is the customer accepting it; only a quote they turned down, or one past its date, is refused.
    if (q.status === "DECLINED" || q.status === "EXPIRED") throw new ActionError(`Quote ${q.ref} is ${q.status.toLowerCase()}. Set it back to Sent first if the customer has changed their mind.`);
    const t = totals(q.items, q.discountCents, q.taxRateBp);
    const when = new Date(startAt);
    validSlot(when, 120);
    const duration = q.items.reduce((a: number, i: any) => a + (i.service?.durationMin ?? 120) * i.qty, 0) || 120;
    const booking = await db.booking.create({ data: {
      ref: await nextRef("BKG", "booking", db), customerId: q.customerId,
      addressId: q.customer.addresses.find((a: any) => a.isPrimary)?.id ?? q.customer.addresses[0]?.id,
      startAt: when, durationMin: duration, notes: q.notes, quoteId: q.id,
      items: { create: q.items.filter((i: any) => i.serviceId).map((i: any) => ({ serviceId: i.serviceId!, qty: i.qty, priceCents: i.priceCents, name: i.name })) },
    } });
    const job = await db.job.create({ data: {
      ref: await nextRef("JOB", "job", db), bookingId: booking.id, customerId: q.customerId,
      addressId: booking.addressId, scheduledAt: when, durationMin: duration,
      revenueCents: t.total, customerInstructions: q.notes,
      checklist: { create: q.items.map((i: any, n: number) => ({ label: i.name, sort: n })) },
    } });
    await db.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED", convertedBookingId: booking.id } });
    return { quoteRef: q.ref, bookingRef: booking.ref, jobRef: job.ref, totalCents: t.total };
  }),
});

defineAction({
  name: "quotes.convertToInvoice",
  description: "Bill a quotation directly, without scheduling a visit first. Copies its line items, discount, tax and notes onto a new invoice and marks the quote accepted. Use for 'invoice this quote'.",
  category: "Quotes", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ quoteId: z.string(), dueDays: z.number().int().min(0).default(14) }),
  handler: async ({ quoteId, dueDays }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { items: true, customer: true } });
    if (!q) throw new ActionError("Quote not found");

    // Like convertedBookingId, this is a plain column rather than a foreign key,
    // so it can name an invoice that has since been deleted. A quote whose
    // invoice is gone may be billed again; one whose invoice is still there
    // opens it instead of raising a second bill for the same work.
    if (q.convertedInvoiceId) {
      const prior = await db.invoice.findUnique({ where: { id: q.convertedInvoiceId }, select: { id: true, ref: true } });
      if (prior) return { invoiceId: prior.id, ref: prior.ref, quoteRef: q.ref, existing: true };
    }
    // A quote that became a booking is billed through its job, so that the work
    // is invoiced once, when it has actually been done.
    if (q.convertedBookingId) {
      const booking = await db.booking.findUnique({ where: { id: q.convertedBookingId }, select: { ref: true } });
      if (booking) throw new ActionError(`This quote is scheduled as booking ${booking.ref}. Invoice it from the completed job, so the work is not billed twice.`);
    }
    if (q.status === "DECLINED" || q.status === "EXPIRED") throw new ActionError(`Quote ${q.ref} is ${q.status.toLowerCase()}. Set it back to Sent first if the customer has changed their mind.`);

    const inv = await db.invoice.create({ data: {
      ref: await nextRef("INV", "invoice"), customerId: q.customerId, status: "SENT",
      discountCents: q.discountCents, taxRateBp: q.taxRateBp, dueAt: addDays(new Date(), dueDays),
      notes: `Quotation reference: ${q.ref}${q.notes ? `\n${q.notes}` : ""}`,
      items: { create: q.items.map((i) => ({ name: i.name, qty: i.qty, priceCents: i.priceCents })) },
    }, include: { items: true } });
    await db.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED", convertedInvoiceId: inv.id } });
    await notify({ type: "INVOICE", title: `Invoice ${inv.ref} raised`, body: `${q.customer.name} \u00b7 quote ${q.ref}`, link: `/invoices/${inv.id}` });
    return { invoiceId: inv.id, ref: inv.ref, quoteRef: q.ref, ...totals(inv.items, q.discountCents, q.taxRateBp) };
  },
});

/* --------------------------------- Invoices -------------------------------- */

defineAction({
  name: "invoices.list",
  description: "List invoices with their totals, amount paid and outstanding balance. Use for 'show me all unpaid invoices' or 'who hasn't paid'.",
  category: "Invoices", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({
    status: z.enum(["DRAFT","SENT","PARTIAL","PAID","OVERDUE","VOID"]).optional(),
    unpaidOnly: z.boolean().default(false).describe("Only invoices with a balance still outstanding"),
    customerId: optionalId(), from: z.string().optional(), to: z.string().optional(),
    limit: z.number().int().max(200).default(100),
  }),
  handler: async ({ status, unpaidOnly, customerId, from, to, limit }) => {
    const rows = await db.invoice.findMany({
      where: { ...(status ? { status } : {}), ...(customerId ? { customerId } : {}),
        ...(from || to ? { issuedAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}) },
      orderBy: { issuedAt: "desc" }, take: limit,
      include: { customer: true, items: true, payments: true },
    });
    return rows.map((inv) => {
      const t = invoiceTotals(inv);
      return { id: inv.id, ref: inv.ref, customer: inv.customer.name, customerId: inv.customerId,
        status: inv.status, issuedAt: inv.issuedAt, dueAt: inv.dueAt,
        totalCents: t.total, paidCents: t.paid, balanceCents: t.balance,
        overdue: !!inv.dueAt && inv.dueAt < new Date() && t.balance > 0 };
    }).filter((r) => !unpaidOnly || r.balanceCents > 0);
  },
});

defineAction({
  name: "invoices.get",
  description: "Get one invoice in full with line items and payment history.",
  category: "Invoices", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ invoiceId: z.string() }),
  handler: async ({ invoiceId }) => {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { customer: { include: { addresses: true } }, items: true, jobs: true,
      payments: { include: { receivedBy: { select: { id: true, name: true } } } } } });
    if (!inv) throw new ActionError("Invoice not found");
    return { ...inv, ...invoiceTotals(inv) };
  },
});

defineAction({
  name: "invoices.create",
  description: "Create an invoice for a customer from explicit line items.",
  category: "Invoices", roles: ["OWNER", "ADMIN"],
  input: z.object({
    customerId: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1).default(1), priceCents: z.number().int() })).min(1),
    discountCents: z.number().int().min(0).default(0), taxRateBp: z.number().int().min(0).default(0),
    dueDays: z.number().int().default(14), notes: z.string().optional(),
    status: z.enum(["DRAFT","SENT"]).default("SENT"),
  }),
  handler: async (i) => {
    const inv = await db.invoice.create({ data: {
      ref: await nextRef("INV", "invoice"), customerId: i.customerId, status: i.status,
      discountCents: i.discountCents, taxRateBp: i.taxRateBp, notes: i.notes,
      dueAt: addDays(new Date(), i.dueDays), items: { create: i.items },
    }, include: { items: true, customer: true } });
    await notify({ type: "INVOICE", title: `Invoice ${inv.ref} created`, body: inv.customer.name, link: `/invoices/${inv.id}` });
    return { ...inv, ...totals(inv.items, inv.discountCents, inv.taxRateBp) };
  },
});

defineAction({
  name: "invoices.createFromJob",
  description: "Create an invoice for a completed job, using the job's services as line items and linking the job to it. Use for 'create an invoice for this completed job'.",
  category: "Invoices", roles: ["OWNER", "ADMIN"],
  input: z.object({ jobId: z.string(), dueDays: z.number().int().default(14), taxRateBp: z.number().int().min(0).optional() }),
  handler: async ({ jobId, dueDays, taxRateBp }) => scheduleWrite(async (db) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { customer: true, booking: { include: { items: true } } } });
    if (!j) throw new ActionError("Job not found");
    if (j.invoiceId) throw new ActionError(`Job ${j.ref} is already on an invoice`);
    const quote = j.booking?.quoteId ? await db.quote.findUnique({ where: { id: j.booking.quoteId }, include: { items: true } }) : null;
    const discountCents = quote?.discountCents ?? 0;
    const rate = taxRateBp ?? quote?.taxRateBp ?? 0;
    const items = quote ? quote.items.map((i: any) => ({ name: i.name, qty: i.qty, priceCents: i.priceCents })) : j.booking?.items.length
      ? j.booking.items.map((i: any) => ({ name: i.name, qty: i.qty, priceCents: i.priceCents }))
      : [{ name: `Cleaning service — job ${j.ref}`, qty: 1, priceCents: j.revenueCents }];
    const inv = await db.invoice.create({ data: {
      ref: await nextRef("INV", "invoice", db), customerId: j.customerId, status: "SENT",
      taxRateBp: rate, discountCents, dueAt: addDays(new Date(), dueDays), items: { create: items },
    }, include: { items: true } });
    await db.job.update({ where: { id: jobId }, data: { invoiceId: inv.id } });
    await notify({ type: "INVOICE", title: `Invoice ${inv.ref} raised`, body: `${j.customer.name} · job ${j.ref}`, link: `/invoices/${inv.id}` }, db);
    return { invoiceId: inv.id, ref: inv.ref, jobRef: j.ref, ...totals(inv.items, discountCents, rate) };
  }),
});

defineAction({
  name: "invoices.updateStatus",
  description: "Change an invoice's status, for example to send it or void it.",
  category: "Invoices", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ invoiceId: z.string(), status: z.enum(["DRAFT","SENT","PARTIAL","PAID","OVERDUE","VOID"]) }),
  handler: async ({ invoiceId, status }) => db.invoice.update({ where: { id: invoiceId }, data: { status } }),
});

/** "13 Aug 2026" on the Kuching calendar, for a line that names its visit. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Visit days on the Kuching calendar, as compactly as they read: "27 Aug, 3, 10 Sep 2026". */
export function visitDays(dates: Date[]) {
  const days = [...new Set(dates.map((d) => businessClock(d).date))].sort().map((s) => s.split("-").map(Number));
  const out: string[] = [];
  days.forEach(([y, m, d], i) => {
    const next = days[i + 1];
    const endOfMonth = !next || next[0] !== y || next[1] !== m;
    const endOfYear = !next || next[0] !== y;
    out.push(`${d}${endOfMonth ? ` ${MONTHS[m - 1]}` : ""}${endOfYear ? ` ${y}` : ""}`);
  });
  return out.join(", ");
}

defineAction({
  name: "invoices.merge",
  description: "Combine two or more invoices for the SAME customer into one new invoice, e.g. 'put all of Ms Sim's unpaid invoices on one bill'. Every line, job and payment moves to the new invoice; the old invoices are voided with a note pointing to it, so no sale or collection changes. Find them first with invoices_list (customerId, unpaidOnly) and pass their refs or ids.",
  category: "Invoices", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({
    invoices: z.array(z.string()).min(2).describe("Two or more invoice refs (INV-0042) or ids, all for the same customer"),
    dueDays: z.number().int().min(0).default(14).describe("Days from today until the combined invoice is due"),
    notes: z.string().optional(),
  }),
  handler: async ({ invoices, dueDays, notes }) => scheduleWrite(async (db) => {
    const keys = invoices.map((k) => k.trim());
    const wanted = [...new Set(keys.map((k) => k.toUpperCase()))];
    if (wanted.length !== keys.length) throw new ActionError("The same invoice is listed twice.");
    const found = await db.invoice.findMany({
      where: { OR: [{ id: { in: keys } }, { ref: { in: keys.map((k) => k.toUpperCase()) } }] },
      include: { items: true, payments: true, customer: { select: { name: true } }, jobs: { select: { id: true, ref: true, scheduledAt: true } } },
    });
    const missing = keys.filter((k) => !found.some((f: any) => f.id === k || f.ref === k.toUpperCase()));
    if (missing.length) throw new ActionError(`No invoice found for ${missing.join(", ")}.`);
    if (found.length < 2) throw new ActionError("Choose at least two different invoices to combine.");
    if (new Set(found.map((f: any) => f.customerId)).size > 1)
      throw new ActionError(`Only one customer's invoices can be combined. These belong to ${[...new Set(found.map((f: any) => f.customer.name))].join(" and ")}.`);
    const voided = found.filter((f: any) => f.status === "VOID");
    if (voided.length) throw new ActionError(`${voided.map((f: any) => f.ref).join(", ")} ${voided.length > 1 ? "are" : "is"} void and cannot be combined.`);
    if (new Set(found.map((f: any) => f.taxRateBp)).size > 1) throw new ActionError("These invoices charge different tax rates, so they cannot share one invoice.");

    // Oldest work first, so the combined bill reads like a statement.
    const when = (f: any) => Math.min(...f.jobs.map((j: any) => j.scheduledAt.getTime()), f.issuedAt.getTime());
    const sources = [...found].sort((a: any, b: any) => when(a) - when(b));
    // The printed invoice is one A4 page, so the same service at the same price
    // becomes one line with a quantity, named with the visit days it covers.
    // Lines from an invoice that already covers several visits keep their name.
    const groups = new Map<string, { name: string; qty: number; priceCents: number; days: Date[] }>();
    for (const f of sources) for (const i of f.items) {
      const day = f.jobs.length === 1 ? f.jobs[0].scheduledAt : null;
      const key = `${i.name}\u0000${i.priceCents}\u0000${day ? "dated" : "as-is"}`;
      const g = groups.get(key) ?? { name: i.name, qty: 0, priceCents: i.priceCents, days: [] as Date[] };
      g.qty += i.qty;
      if (day) g.days.push(day);
      groups.set(key, g);
    }
    const items = [...groups.values()].map((g) => ({
      name: g.days.length ? `${g.name} — ${visitDays(g.days)}` : g.name, qty: g.qty, priceCents: g.priceCents,
    }));
    const refs = sources.map((f: any) => f.ref);

    const inv = await db.invoice.create({ data: {
      ref: await nextRef("INV", "invoice", db), customerId: sources[0].customerId,
      status: sources.every((f: any) => f.status === "DRAFT") ? "DRAFT" : "SENT",
      discountCents: sources.reduce((a: number, f: any) => a + f.discountCents, 0), taxRateBp: sources[0].taxRateBp,
      dueAt: addDays(new Date(), dueDays),
      notes: [`Combines ${refs.join(", ")}.`, notes].filter(Boolean).join("\n"),
      items: { create: items },
    } });
    const ids = sources.map((f: any) => f.id);
    // Payments keep their own date, so what was collected in each month does not move.
    await db.payment.updateMany({ where: { invoiceId: { in: ids } }, data: { invoiceId: inv.id } });
    await db.job.updateMany({ where: { invoiceId: { in: ids } }, data: { invoiceId: inv.id } });
    await db.quote.updateMany({ where: { convertedInvoiceId: { in: ids } }, data: { convertedInvoiceId: inv.id } });
    // The old invoices stay, voided, so their refs still lead somewhere.
    for (const f of sources) {
      await db.invoice.update({ where: { id: f.id }, data: { status: "VOID",
        notes: [f.notes, `Combined into ${inv.ref}.`].filter(Boolean).join("\n") } });
    }
    await syncStatus(db, inv.id);
    const out = await db.invoice.findUnique({ where: { id: inv.id }, include: { items: true, payments: true } });
    const t = invoiceTotals(out);
    await notify({ type: "INVOICE", title: `Invoice ${inv.ref} combines ${refs.length} invoices`, body: `${sources[0].customer.name} · ${refs.join(", ")}`, link: `/invoices/${inv.id}` }, db);
    return { invoiceId: inv.id, ref: inv.ref, customer: sources[0].customer.name, combined: refs, status: out.status,
      totalCents: t.total, paidCents: t.paid, balanceCents: t.balance, lines: items.length };
  }),
});

/* --------------------------------- Payments -------------------------------- */

defineAction({
  name: "payments.record",
  description: "Record a payment against an invoice. Supports partial payments; the invoice status updates automatically. When a cleaner or driver collected the money from the customer (e.g. 'Jong collected it'), pass their staffId as receivedById: it then counts against what the business owes them. Leave it empty when the owner received the money.",
  category: "Payments", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({
    invoiceId: z.string(),
    amountCents: z.number().int().min(1).describe("Amount received in cents, e.g. RM 250.00 is 25000"),
    method: z.enum(["CASH","BANK","CARD","EWALLET","CHEQUE"]).default("CASH"),
    reference: z.string().optional(), note: z.string().optional(), paidAt: z.string().optional(),
    receivedById: optionalId().describe("Staff id of the cleaner or driver who collected it; omit when the owner received it"),
  }),
  handler: async (i) => {
    const inv = await db.invoice.findUnique({ where: { id: i.invoiceId }, include: { items: true, payments: true, customer: true } });
    const collector = i.receivedById ? await db.staff.findUnique({ where: { id: i.receivedById }, select: { id: true, name: true } }) : null;
    if (i.receivedById && !collector) throw new ActionError("That cleaner was not found. Pick them from the staff list.");
    if (!inv) throw new ActionError("Invoice not found");
    // Money taken against a voided invoice would count as takings for a bill
    // that no longer exists. The screens hide the button; this stops the assistant too.
    if (inv.status === "VOID") throw new ActionError(`Invoice ${inv.ref} is void. Set it back to Sent first, or raise a new invoice.`);
    const before = invoiceTotals(inv);
    if (i.amountCents > before.balance) throw new ActionError(`Payment exceeds the outstanding balance of ${(before.balance/100).toFixed(2)}`);
    const p = await db.payment.create({ data: {
      ref: await nextRef("PAY", "payment"), invoiceId: i.invoiceId, customerId: inv.customerId,
      amountCents: i.amountCents, method: i.method, reference: i.reference, note: i.note,
      paidAt: i.paidAt ? new Date(i.paidAt) : new Date(), receivedById: collector?.id ?? null,
    } });
    const updated = await syncInvoiceStatus(i.invoiceId);
    return { paymentRef: p.ref, invoiceRef: inv.ref, customer: inv.customer.name, collectedBy: collector?.name ?? null,
      amountCents: p.amountCents, remainingBalanceCents: before.balance - i.amountCents, invoiceStatus: updated?.status };
  },
});

defineAction({
  name: "payments.refund",
  description: "Record a refund against an invoice. This reverses money already received.",
  category: "Payments", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ invoiceId: z.string(), amountCents: z.number().int().min(1), method: z.enum(["CASH","BANK","CARD","EWALLET","CHEQUE"]).default("BANK"), note: z.string().optional() }),
  handler: async (i) => {
    const inv = await db.invoice.findUnique({ where: { id: i.invoiceId }, include: { items: true, payments: true } });
    if (!inv) throw new ActionError("Invoice not found");
    // Only money that came in can go back out; anything more would be invented.
    const { paid } = invoiceTotals(inv);
    if (i.amountCents > paid) throw new ActionError(`A refund cannot be more than what has been paid on ${inv.ref}: ${(Math.max(0, paid) / 100).toFixed(2)}.`);
    const p = await db.payment.create({ data: {
      ref: await nextRef("PAY", "payment"), invoiceId: i.invoiceId, customerId: inv.customerId,
      amountCents: i.amountCents, method: i.method, note: i.note, isRefund: true,
    } });
    await syncInvoiceStatus(i.invoiceId);
    return { refundRef: p.ref, invoiceRef: inv.ref, amountCents: i.amountCents };
  },
});

defineAction({
  name: "payments.list",
  description: "List recorded payments and refunds over a period.",
  category: "Payments", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ from: z.string().optional(), to: z.string().optional(), customerId: optionalId(), limit: z.number().int().max(200).default(100) }),
  handler: async ({ from, to, customerId, limit }) => {
    const rows = await db.payment.findMany({
      where: { ...(customerId ? { customerId } : {}),
        ...(from || to ? { paidAt: { ...(from ? { gte: startOfDay(new Date(from)) } : {}), ...(to ? { lte: endOfDay(new Date(to)) } : {}) } } : {}) },
      orderBy: { paidAt: "desc" }, take: limit, include: { customer: true, invoice: true, receivedBy: { select: { name: true } } },
    });
    return rows.map((p) => ({ id: p.id, ref: p.ref, customer: p.customer.name, invoiceRef: p.invoice?.ref, collectedBy: p.receivedBy?.name ?? null,
      amountCents: p.isRefund ? -p.amountCents : p.amountCents, method: p.method, paidAt: p.paidAt, isRefund: p.isRefund }));
  },
});

defineAction({
  name: "payments.outstanding",
  description: "Summary of all money owed to the business: total outstanding, overdue amount, and the customers who owe it.",
  category: "Payments", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({}),
  handler: async () => {
    // Only invoices that can still carry a balance. `notIn: [VOID, DRAFT]` pulled
    // every PAID invoice ever raised as well, just to compute a zero balance.
    const invs = await db.invoice.findMany({
      where: { status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
      include: { items: true, payments: true, customer: { select: { id: true, name: true } } },
    });
    const open = invs.map((i) => ({ inv: i, t: invoiceTotals(i) })).filter((x) => x.t.balance > 0);
    const byCustomer = new Map<string, { customer: string; customerId: string; balanceCents: number; invoices: number }>();
    for (const { inv, t } of open) {
      const e = byCustomer.get(inv.customerId) ?? { customer: inv.customer.name, customerId: inv.customerId, balanceCents: 0, invoices: 0 };
      e.balanceCents += t.balance; e.invoices++; byCustomer.set(inv.customerId, e);
    }
    const overdue = open.filter((x) => x.inv.dueAt && x.inv.dueAt < new Date());
    return {
      totalOutstandingCents: open.reduce((a, x) => a + x.t.balance, 0),
      overdueCents: overdue.reduce((a, x) => a + x.t.balance, 0),
      openInvoices: open.length, overdueInvoices: overdue.length,
      byCustomer: [...byCustomer.values()].sort((a, b) => b.balanceCents - a.balanceCents),
    };
  },
});
