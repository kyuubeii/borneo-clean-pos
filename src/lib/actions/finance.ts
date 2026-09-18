import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { nextRef } from "../ref";
import { totals } from "../money";
import { startOfDay, endOfDay, addDays } from "../dates";
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
  handler: async ({ quoteId, status }) => db.quote.update({ where: { id: quoteId }, data: { status } }),
});

defineAction({
  name: "quotes.convertToBooking",
  description: "Turn an accepted quote into a booking and job at a given date/time.",
  category: "Quotes", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ quoteId: z.string(), startAt: z.string().describe("ISO datetime for the visit") }),
  handler: async ({ quoteId, startAt }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { items: { include: { service: true } }, customer: { include: { addresses: true } } } });
    if (!q) throw new ActionError("Quote not found");
    if (q.convertedBookingId) throw new ActionError("This quote has already been converted");
    const t = totals(q.items, q.discountCents, q.taxRateBp);
    const when = new Date(startAt);
    const duration = q.items.reduce((a, i) => a + (i.service?.durationMin ?? 120) * i.qty, 0) || 120;
    const booking = await db.booking.create({ data: {
      ref: await nextRef("BKG", "booking"), customerId: q.customerId,
      addressId: q.customer.addresses.find((a) => a.isPrimary)?.id ?? q.customer.addresses[0]?.id,
      startAt: when, durationMin: duration, notes: q.notes, quoteId: q.id,
      items: { create: q.items.filter((i) => i.serviceId).map((i) => ({ serviceId: i.serviceId!, qty: i.qty, priceCents: i.priceCents, name: i.name })) },
    } });
    const job = await db.job.create({ data: {
      ref: await nextRef("JOB", "job"), bookingId: booking.id, customerId: q.customerId,
      addressId: booking.addressId, scheduledAt: when, durationMin: duration,
      revenueCents: t.total, customerInstructions: q.notes,
      checklist: { create: q.items.map((i, n) => ({ label: i.name, sort: n })) },
    } });
    await db.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED", convertedBookingId: booking.id } });
    return { quoteRef: q.ref, bookingRef: booking.ref, jobRef: job.ref, totalCents: t.total };
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
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { customer: true, items: true, payments: true, jobs: true } });
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
  input: z.object({ jobId: z.string(), dueDays: z.number().int().default(14), taxRateBp: z.number().int().min(0).default(0) }),
  handler: async ({ jobId, dueDays, taxRateBp }) => {
    const j = await db.job.findUnique({ where: { id: jobId }, include: { customer: true, booking: { include: { items: true } } } });
    if (!j) throw new ActionError("Job not found");
    if (j.invoiceId) throw new ActionError(`Job ${j.ref} is already on an invoice`);
    const items = j.booking?.items.length
      ? j.booking.items.map((i) => ({ name: i.name, qty: i.qty, priceCents: i.priceCents }))
      : [{ name: `Cleaning service — job ${j.ref}`, qty: 1, priceCents: j.revenueCents }];
    const inv = await db.invoice.create({ data: {
      ref: await nextRef("INV", "invoice"), customerId: j.customerId, status: "SENT",
      taxRateBp, dueAt: addDays(new Date(), dueDays), items: { create: items },
    }, include: { items: true } });
    await db.job.update({ where: { id: jobId }, data: { invoiceId: inv.id } });
    await notify({ type: "INVOICE", title: `Invoice ${inv.ref} raised`, body: `${j.customer.name} · job ${j.ref}`, link: `/invoices/${inv.id}` });
    return { invoiceId: inv.id, ref: inv.ref, jobRef: j.ref, ...totals(inv.items, 0, taxRateBp) };
  },
});

defineAction({
  name: "invoices.updateStatus",
  description: "Change an invoice's status, for example to send it or void it.",
  category: "Invoices", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({ invoiceId: z.string(), status: z.enum(["DRAFT","SENT","PARTIAL","PAID","OVERDUE","VOID"]) }),
  handler: async ({ invoiceId, status }) => db.invoice.update({ where: { id: invoiceId }, data: { status } }),
});

/* --------------------------------- Payments -------------------------------- */

defineAction({
  name: "payments.record",
  description: "Record a payment against an invoice. Supports partial payments; the invoice status updates automatically.",
  category: "Payments", roles: ["OWNER", "ADMIN"], requiresConfirm: true,
  input: z.object({
    invoiceId: z.string(),
    amountCents: z.number().int().min(1).describe("Amount received in cents, e.g. RM 250.00 is 25000"),
    method: z.enum(["CASH","BANK","CARD","EWALLET","CHEQUE"]).default("CASH"),
    reference: z.string().optional(), note: z.string().optional(), paidAt: z.string().optional(),
  }),
  handler: async (i) => {
    const inv = await db.invoice.findUnique({ where: { id: i.invoiceId }, include: { items: true, payments: true, customer: true } });
    if (!inv) throw new ActionError("Invoice not found");
    const before = invoiceTotals(inv);
    if (i.amountCents > before.balance) throw new ActionError(`Payment exceeds the outstanding balance of ${(before.balance/100).toFixed(2)}`);
    const p = await db.payment.create({ data: {
      ref: await nextRef("PAY", "payment"), invoiceId: i.invoiceId, customerId: inv.customerId,
      amountCents: i.amountCents, method: i.method, reference: i.reference, note: i.note,
      paidAt: i.paidAt ? new Date(i.paidAt) : new Date(),
    } });
    const updated = await syncInvoiceStatus(i.invoiceId);
    return { paymentRef: p.ref, invoiceRef: inv.ref, customer: inv.customer.name,
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
      orderBy: { paidAt: "desc" }, take: limit, include: { customer: true, invoice: true },
    });
    return rows.map((p) => ({ id: p.id, ref: p.ref, customer: p.customer.name, invoiceRef: p.invoice?.ref,
      amountCents: p.isRefund ? -p.amountCents : p.amountCents, method: p.method, paidAt: p.paidAt, isRefund: p.isRefund }));
  },
});

defineAction({
  name: "payments.outstanding",
  description: "Summary of all money owed to the business: total outstanding, overdue amount, and the customers who owe it.",
  category: "Payments", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({}),
  handler: async () => {
    const invs = await db.invoice.findMany({ where: { status: { notIn: ["VOID", "DRAFT"] } }, include: { items: true, payments: true, customer: true } });
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
