import { assertAvailable, scheduleWrite, setJobStatus } from "../scheduling";
import { z } from "zod";
import { categoryIdFor } from "../categories";
import { db } from "../db";
import { optionalId, nullableId, optionalText, clearableText } from "../schema";
import { defineAction, ActionError } from "../registry";
import { totals, syncInvoiceStatus, fmt } from "../money";
import { setReceipts } from "../notify";
import { assertOwnJob } from "../access";

const ADMIN = ["OWNER", "ADMIN"] as const;

/* ------------------------------- Bookings --------------------------------- */

defineAction({
  name: "bookings.update",
  description: "Edit an existing booking: its services, notes, address or duration. To change the date/time use bookings.reschedule instead.",
  category: "Bookings", roles: [...ADMIN],
  input: z.object({
    bookingId: z.string(),
    status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
    serviceIds: z.array(z.string()).optional().describe("Replaces the whole service list; also updates the job's revenue"),
    addressId: optionalId(), notes: z.string().optional(),
    internalNotes: z.string().optional(), durationMin: z.number().int().min(15).optional(),
  }),
  handler: async ({ bookingId, serviceIds, status, ...rest }) => scheduleWrite(async (db) => {
    const b = await db.booking.findUnique({ where: { id: bookingId }, include: { job: { include: { assignments: true } } } });
    if (!b) throw new ActionError("Booking not found");
    if (serviceIds && (b.quoteId || b.job?.invoiceId)) throw new ActionError("This booking has a quote or invoice. Keep its agreed service lines and create a revised quote for a price change.");
    if (serviceIds) {
      const services = await db.service.findMany({ where: { id: { in: serviceIds } } });
      if (services.length !== serviceIds.length) throw new ActionError("One or more services not found");
      await db.bookingItem.deleteMany({ where: { bookingId } });
      await db.bookingItem.createMany({ data: services.map((s: any) => ({ bookingId, serviceId: s.id, qty: 1, priceCents: s.priceCents, name: s.name })) });
      const revenue = services.reduce((a: number, s: any) => a + s.priceCents, 0);
      const material = services.reduce((a: number, s: any) => a + s.materialCostCents, 0);
      const duration = rest.durationMin ?? services.reduce((a: number, s: any) => a + s.durationMin, 0);
      if (b.job) await db.job.update({ where: { id: b.job.id }, data: { revenueCents: revenue, materialCostCents: material, durationMin: duration } });
      rest.durationMin = duration;
    }
    if (b.job) {
      const duration = rest.durationMin ?? b.durationMin;
      if ((serviceIds || duration !== b.durationMin) && !["COMPLETED", "CANCELLED"].includes(b.job.status))
        await assertAvailable(db, b.job.assignments.map((a: any) => a.staffId), b.startAt, duration, b.job.id);
      await db.job.update({ where: { id: b.job.id }, data: {
        durationMin: duration, addressId: rest.addressId, customerInstructions: rest.notes, internalNotes: rest.internalNotes,
      } });
    }
    if (status && status !== b.status && b.job) await setJobStatus(db, b.job.id, ["CANCELLED", "COMPLETED"].includes(status) ? status : (["EN_ROUTE", "IN_PROGRESS"].includes(b.job.status) ? b.job.status : "SCHEDULED"), status);
    return db.booking.update({ where: { id: bookingId }, data: { ...rest, ...(status ? { status } : {}) }, include: { items: true, customer: true } });
  }),
});

/* --------------------------------- Jobs ----------------------------------- */

defineAction({
  name: "bookings.delete",
  description: "Permanently delete a booking and its line items. Refuses when a job has already been worked or invoiced -- cancel the booking instead, which keeps the record. Use only to remove a booking taken in error.",
  category: "Bookings", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ bookingId: z.string() }),
  handler: async ({ bookingId }) => {
    const b = await db.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true, job: { include: { invoice: true, timeEntries: true, assignments: true } }, children: true },
    });
    if (!b) throw new ActionError("That booking no longer exists.");

    // Job.bookingId is an optional relation with no onDelete rule, so Prisma
    // would quietly set it to null and leave the job stranded with no booking.
    // Anything with work or money attached has to be kept.
    const job = b.job;
    if (job) {
      if (job.invoice) {
        throw new ActionError(`Booking ${b.ref} has already been invoiced (${job.invoice.ref}). Cancel the booking instead so the invoice still makes sense.`);
      }
      if (job.timeEntries.length > 0) {
        throw new ActionError(`A cleaner has already logged time against booking ${b.ref}. Cancel it instead so the hours are kept.`);
      }
      if (job.status !== "SCHEDULED" && job.status !== "CANCELLED") {
        throw new ActionError(`The job for booking ${b.ref} is ${job.status.toLowerCase().replace("_", " ")}. Cancel the booking instead of deleting it.`);
      }
      // Expense.jobId is optional with no onDelete rule either, so deleting the
      // job would leave the spend recorded but attributable to nothing.
      const spend = await db.expense.count({ where: { jobId: job.id } });
      if (spend > 0) {
        throw new ActionError(`${spend} expense(s) are logged against booking ${b.ref}. Cancel it instead so the spending still has a job to sit against.`);
      }
    }
    if (b.children.length > 0) {
      throw new ActionError(`Booking ${b.ref} starts a recurring series of ${b.children.length + 1}. Cancel the series instead, which keeps the history.`);
    }

    // BookingItem cascades. The job does not, so it goes first and explicitly.
    const ref = b.ref, customer = b.customer.name;
    await db.$transaction(async (tx) => {
      if (job) await tx.job.delete({ where: { id: job.id } });
      // Quote.convertedBookingId is a plain column with no foreign key, so it
      // would be left pointing at a booking that no longer exists -- which then
      // blocks the quote from ever being deleted or converted again.
      await tx.quote.updateMany({ where: { convertedBookingId: bookingId }, data: { convertedBookingId: null } });
      await tx.booking.delete({ where: { id: bookingId } });
    });
    return { deleted: `Booking ${ref}`, customer, jobRemoved: job?.ref ?? null };
  },
});

defineAction({
  name: "jobs.addChecklistItem",
  description: "Add a single item to a job's checklist without replacing the existing ones.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), label: z.string().min(1) }),
  handler: async ({ jobId, label }, ctx) => {
    await assertOwnJob(ctx, jobId);
    const n = await db.checklistItem.count({ where: { jobId } });
    return db.checklistItem.create({ data: { jobId, label, sort: n } });
  },
});

defineAction({
  name: "jobs.deletePhoto",
  description: "Remove a photo or attachment from a job.",
  category: "Jobs", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ photoId: z.string() }),
  handler: async ({ photoId }) => { await db.photo.delete({ where: { id: photoId } }); return { deleted: photoId }; },
});

defineAction({
  name: "jobs.logTime",
  description: "Add a completed time entry manually, for example when a cleaner forgot to check in or out. Times are ISO datetimes.",
  category: "Staff", roles: [...ADMIN],
  input: z.object({ jobId: z.string(), staffId: z.string(), startAt: z.string(), endAt: z.string(), note: z.string().optional() }),
  handler: async (i) => {
    const start = new Date(i.startAt), end = new Date(i.endAt);
    if (end <= start) throw new ActionError("The end time must be after the start time");
    return db.timeEntry.create({ data: { jobId: i.jobId, staffId: i.staffId, startAt: start, endAt: end, note: i.note } });
  },
});

defineAction({
  name: "jobs.deleteTimeEntry",
  description: "Delete a tracked time entry. This changes labour cost and payroll, so confirm first.",
  category: "Staff", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ timeEntryId: z.string() }),
  handler: async ({ timeEntryId }) => { await db.timeEntry.delete({ where: { id: timeEntryId } }); return { deleted: timeEntryId }; },
});

/**
 * Correcting a sale has to move three records together, or the books disagree with
 * themselves: the booking line the customer agreed, the job's revenue that reporting
 * reads, and the invoice line they were billed. Anything already paid stays paid — the
 * invoice simply falls back to PARTIAL when the new price is higher than what came in.
 */
defineAction({
  name: "jobs.setPrice",
  description: "Correct what a job is charged at when the amount was recorded wrongly. Updates the booking line, the job's revenue and the invoice together, and puts the invoice back to PAID/PARTIAL/SENT depending on what has been received. Admin only.",
  category: "Jobs", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ jobId: z.string(), amountCents: z.number().int().min(0) }),
  handler: async ({ jobId, amountCents }) => {
    const job = await db.job.findUnique({ where: { id: jobId },
      include: { booking: { include: { items: true } }, invoice: { include: { items: true, payments: true } }, customer: true } });
    if (!job) throw new ActionError("Job not found");

    // One price can only be applied to one line. A multi-service job has to be repriced
    // service by service on the booking, otherwise we would silently drop a line.
    if (job.booking && job.booking.items.length > 1)
      throw new ActionError(`${job.ref} covers ${job.booking.items.length} services. Edit the prices on booking ${job.booking.ref} instead, so each service keeps its own amount.`);
    if (job.invoice && job.invoice.items.length > 1)
      throw new ActionError(`Invoice ${job.invoice.ref} has ${job.invoice.items.length} lines. Edit it directly so each line keeps its own amount.`);

    if (job.booking?.quoteId) throw new ActionError("This job uses an agreed quote. Create a revised quote instead of replacing its total.");
    const was = job.revenueCents;
    await db.job.update({ where: { id: jobId }, data: { revenueCents: amountCents } });
    if (job.booking?.items[0]) await db.bookingItem.update({ where: { id: job.booking.items[0].id }, data: { priceCents: amountCents, qty: 1 } });
    if (job.invoice?.items[0]) await db.invoiceItem.update({ where: { id: job.invoice.items[0].id }, data: { priceCents: amountCents, qty: 1 } });
    if (job.invoiceId) await syncInvoiceStatus(db, job.invoiceId);

    const inv = job.invoiceId ? await db.invoice.findUnique({ where: { id: job.invoiceId }, include: { payments: true } }) : null;
    const paid = inv?.payments.reduce((a, p) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0) ?? 0;
    return { ref: job.ref, customer: job.customer.name, wasCents: was, nowCents: amountCents,
      invoice: inv ? { ref: inv.ref, status: inv.status, paidCents: paid, outstandingCents: amountCents - paid } : null,
      summary: `${job.ref} ${fmt(was)} -> ${fmt(amountCents)}` };
  },
});

/**
 * Attribution fixes. The money never moves; it just belongs to a different name, so
 * every record that carries the customer has to move at once or the customer pages
 * disagree with each other.
 */
defineAction({
  name: "jobs.reassignCustomer",
  description: "Move a job to a different customer when it was filed under the wrong name. Moves the booking, job, invoice and any payments together, and re-points the address at the new customer's primary one. Nothing about the amount changes.",
  category: "Jobs", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ jobId: z.string(), customerId: z.string(), addressId: optionalId().describe("Defaults to the new customer's primary address") }),
  handler: async ({ jobId, customerId, addressId }) => {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { customer: true, booking: true } });
    if (!job) throw new ActionError("Job not found");
    const to = await db.customer.findUnique({ where: { id: customerId }, include: { addresses: true } });
    if (!to) throw new ActionError("That customer no longer exists.");
    if (job.customerId === customerId) throw new ActionError(`${job.ref} is already filed under ${to.name}.`);

    // The old address belongs to the old customer, so it cannot come along.
    const addr = addressId
      ? to.addresses.find((a) => a.id === addressId) ?? null
      : to.addresses.find((a) => a.isPrimary) ?? to.addresses[0] ?? null;
    if (addressId && !addr) throw new ActionError("That address does not belong to the customer you are moving the job to.");

    const from = job.customer.name;
    await db.job.update({ where: { id: jobId }, data: { customerId, addressId: addr?.id ?? null } });
    if (job.bookingId) await db.booking.update({ where: { id: job.bookingId }, data: { customerId, addressId: addr?.id ?? null } });
    let payments = 0;
    if (job.invoiceId) {
      await db.invoice.update({ where: { id: job.invoiceId }, data: { customerId } });
      payments = (await db.payment.updateMany({ where: { invoiceId: job.invoiceId }, data: { customerId } })).count;
    }
    return { ref: job.ref, from, to: to.name, address: addr?.line1 ?? null, paymentsMoved: payments };
  },
});

/* -------------------------------- Quotes ---------------------------------- */

defineAction({
  name: "quotes.get",
  description: "Get one quotation in full, including every line item and the calculated totals.",
  category: "Quotes", roles: [...ADMIN], readOnly: true,
  input: z.object({ quoteId: z.string() }),
  handler: async ({ quoteId }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { customer: { include: { addresses: true } }, items: true } });
    if (!q) throw new ActionError("Quote not found");
    return { ...q, ...totals(q.items, q.discountCents, q.taxRateBp) };
  },
});

defineAction({
  name: "quotes.update",
  description: "Edit a quotation's line items, discount, tax rate, validity or notes.",
  category: "Quotes", roles: [...ADMIN],
  input: z.object({
    quoteId: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1).default(1), priceCents: z.number().int(), serviceId: optionalId() })).optional().describe("Replaces all line items"),
    discountCents: z.number().int().min(0).optional(), taxRateBp: z.number().int().min(0).optional(),
    validUntil: z.string().optional(), notes: z.string().optional(),
  }),
  handler: async ({ quoteId, items, validUntil, ...rest }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId } });
    if (!q) throw new ActionError("Quote not found");
    if (q.convertedBookingId) throw new ActionError("This quote has already been turned into a booking, so it can no longer be edited. Edit the booking instead.");
    if (q.convertedInvoiceId) {
      const inv = await db.invoice.findUnique({ where: { id: q.convertedInvoiceId }, select: { ref: true } });
      if (inv) throw new ActionError(`This quote has already been invoiced as ${inv.ref}, so it can no longer be edited. Edit the invoice instead.`);
    }
    if (items) {
      await db.quoteItem.deleteMany({ where: { quoteId } });
      await db.quoteItem.createMany({ data: items.map((i) => ({ ...i, quoteId })) });
    }
    return db.quote.update({ where: { id: quoteId },
      data: { ...rest, ...(validUntil ? { validUntil: new Date(validUntil) } : {}) },
      include: { items: true, customer: true } });
  },
});

defineAction({
  name: "quotes.delete",
  description: "Permanently delete a quotation.",
  category: "Quotes", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ quoteId: z.string() }),
  handler: async ({ quoteId }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId } });
    if (!q) throw new ActionError("Quote not found");
    // The pointer is a plain column, not a foreign key, so it can outlive the
    // booking it names. Only a booking that is still there should block this.
    if (q.convertedBookingId) {
      const booking = await db.booking.findUnique({ where: { id: q.convertedBookingId }, select: { ref: true } });
      if (booking) throw new ActionError(`This quote has already been turned into booking ${booking.ref}. Cancel that booking instead.`);
    }
    if (q.convertedInvoiceId) {
      const inv = await db.invoice.findUnique({ where: { id: q.convertedInvoiceId }, select: { ref: true } });
      if (inv) throw new ActionError(`This quote has already been invoiced as ${inv.ref}. Void that invoice instead.`);
    }
    await db.quote.delete({ where: { id: quoteId } });
    return { deleted: q.ref };
  },
});

/* ------------------------------- Invoices --------------------------------- */

defineAction({
  name: "invoices.update",
  description: "Edit an invoice's line items, discount, tax rate, due date or notes. Cannot edit an invoice that already has payments against it.",
  category: "Invoices", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({
    invoiceId: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1).default(1), priceCents: z.number().int() })).optional().describe("Replaces all line items"),
    discountCents: z.number().int().min(0).optional(), taxRateBp: z.number().int().min(0).optional(),
    dueAt: z.string().optional(), notes: z.string().optional(),
  }),
  handler: async ({ invoiceId, items, dueAt, ...rest }) => {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, items: true, jobs: { select: { id: true } } } });
    if (!inv) throw new ActionError("Invoice not found");
    if (items && inv.payments.length) throw new ActionError(`Invoice ${inv.ref} already has payments against it, so its line items are fixed. Void it and raise a new one instead.`);
    // The job's revenue is what Sales reads, so it has to follow the bill. An
    // invoice for one job carries its new total onto that job; one that bills
    // several cannot say how to split a change, so its amount is changed job by job.
    const before = totals(inv.items, inv.discountCents, inv.taxRateBp).total;
    const after = totals(items ?? inv.items, rest.discountCents ?? inv.discountCents, rest.taxRateBp ?? inv.taxRateBp).total;
    if (after !== before && inv.jobs.length > 1)
      throw new ActionError(`Invoice ${inv.ref} bills ${inv.jobs.length} jobs, so its total cannot change here. Change each job's amount instead.`);
    if (items) {
      await db.invoiceItem.deleteMany({ where: { invoiceId } });
      await db.invoiceItem.createMany({ data: items.map((i) => ({ ...i, invoiceId })) });
    }
    if (after !== before && inv.jobs.length === 1) await db.job.update({ where: { id: inv.jobs[0].id }, data: { revenueCents: after } });
    return db.invoice.update({ where: { id: invoiceId },
      data: { ...rest, ...(dueAt ? { dueAt: new Date(dueAt) } : {}) },
      include: { items: true, customer: true } });
  },
});

defineAction({
  name: "invoices.delete",
  description: "Permanently delete an invoice that has no payments. Prefer voiding it with invoices.updateStatus to keep the record.",
  category: "Invoices", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ invoiceId: z.string() }),
  handler: async ({ invoiceId }) => {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!inv) throw new ActionError("Invoice not found");
    if (inv.payments.length) throw new ActionError(`Invoice ${inv.ref} has payments against it and cannot be deleted. Void it instead, which keeps the record and the payments.`);
    await db.job.updateMany({ where: { invoiceId }, data: { invoiceId: null } });
    await db.invoice.delete({ where: { id: invoiceId } });
    return { deleted: inv.ref };
  },
});

/* -------------------------------- Payments -------------------------------- */

defineAction({
  name: "payments.delete",
  description: "Delete a payment recorded in error. This changes the invoice balance and the books, so confirm carefully. For money genuinely returned to a customer use payments.refund instead.",
  category: "Payments", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ paymentId: z.string() }),
  handler: async ({ paymentId }) => {
    const p = await db.payment.findUnique({ where: { id: paymentId }, include: { invoice: { include: { items: true, payments: true } } } });
    if (!p) throw new ActionError("Payment not found");
    await db.payment.delete({ where: { id: paymentId } });
    if (p.invoiceId) await syncInvoiceStatus(db, p.invoiceId);
    return { deleted: p.ref, amountCents: p.amountCents };
  },
});

/* -------------------------------- Expenses -------------------------------- */

defineAction({
  name: "expenses.update",
  description: "Edit a recorded expense: amount, category, vendor, note, date, linked job or reimbursable flag.",
  category: "Expenses", roles: [...ADMIN],
  input: z.object({
    expenseId: z.string(), amountCents: z.number().int().min(1).optional(),
    categoryName: optionalText(), vendor: z.string().nullish(), note: z.string().nullish(),
    spentAt: z.string().optional(), jobId: nullableId(),
    staffId: nullableId().describe("Who paid it out of their own pocket. Pass null for money that came straight out of business cash. Moving an expense to a different person clears its reimbursed tick, because the tick recorded a repayment to the previous person."),
    reimbursable: z.boolean().optional(),
  }),
  handler: async ({ expenseId, categoryName, spentAt, staffId, ...rest }) => {
    const e = await db.expense.findUnique({ where: { id: expenseId } });
    if (!e) throw new ActionError("Expense not found");
    const categoryId = await categoryIdFor(categoryName);
    // A reimbursed tick says "this person has been paid back for this row". It cannot
    // follow the row to somebody else, who may never have been paid anything.
    const movedPayer = staffId !== undefined && staffId !== e.staffId;
    return db.expense.update({ where: { id: expenseId },
      data: { ...rest, ...(categoryId ? { categoryId } : {}),
        ...(spentAt ? { spentAt: new Date(spentAt) } : {}),
        ...(staffId === undefined ? {} : { staffId, reimbursable: rest.reimbursable ?? !!staffId }),
        ...(movedPayer ? { reimbursed: false } : {}) },
      include: { category: true, staff: true } });
  },
});

defineAction({
  name: "expenses.delete",
  description: "Delete an expense record.",
  category: "Expenses", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ expenseId: z.string() }),
  handler: async ({ expenseId }) => {
    const e = await db.expense.findUnique({ where: { id: expenseId } });
    if (!e) throw new ActionError("Expense not found");
    await db.expense.delete({ where: { id: expenseId } });
    return { deleted: e.ref, amountCents: e.amountCents };
  },
});

/* ------------------------------- Customers -------------------------------- */

defineAction({
  name: "customers.updateAddress",
  description: "Edit one of a customer's service addresses, including its access notes.",
  category: "Customers", roles: [...ADMIN],
  // Same rule as customers.update: everything optional on the record can be
  // cleared with an empty string, so the form can take a stale postcode or a
  // door code that changed off the address. line1 is what makes it an address.
  input: z.object({ addressId: z.string(), label: z.string().min(1).optional(), line1: z.string().min(1).optional(),
    line2: clearableText(), city: clearableText(), state: clearableText(),
    postcode: clearableText(), accessNotes: clearableText(), isPrimary: z.boolean().optional() }),
  handler: async ({ addressId, isPrimary, ...rest }) => {
    const a = await db.address.findUnique({ where: { id: addressId } });
    if (!a) throw new ActionError("Address not found");
    if (isPrimary) await db.address.updateMany({ where: { customerId: a.customerId }, data: { isPrimary: false } });
    return db.address.update({ where: { id: addressId }, data: { ...rest, ...(isPrimary === undefined ? {} : { isPrimary }) } });
  },
});

defineAction({
  name: "customers.deleteAddress",
  description: "Remove a service address from a customer. Refused if bookings or jobs still reference it.",
  category: "Customers", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ addressId: z.string() }),
  handler: async ({ addressId }) => {
    const a = await db.address.findUnique({ where: { id: addressId } });
    if (!a) throw new ActionError("That address no longer exists.");
    const used = await db.booking.count({ where: { addressId } }) + await db.job.count({ where: { addressId } });
    if (used > 0) throw new ActionError(`${a.label} (${a.line1}) is used by ${used} booking(s)/job(s) and cannot be removed. Edit it instead, so the past work still says where it happened.`);
    await db.address.delete({ where: { id: addressId } });
    // Removing the primary one would otherwise leave the customer with
    // addresses and none of them primary. Hand it to the next oldest.
    let promoted: string | null = null;
    if (a.isPrimary) {
      const next = await db.address.findFirst({ where: { customerId: a.customerId }, orderBy: { id: "asc" } });
      if (next) { await db.address.update({ where: { id: next.id }, data: { isPrimary: true } }); promoted = next.label; }
    }
    return { deleted: a.label, ...(promoted ? { promotedToPrimary: promoted } : {}) };
  },
});

defineAction({
  name: "customers.delete",
  description: "Permanently delete a customer with no history. If they have bookings, jobs or invoices, deactivate them with customers.update instead.",
  category: "Customers", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ customerId: z.string() }),
  handler: async ({ customerId }) => {
    const c = await db.customer.findUnique({ where: { id: customerId },
      include: { _count: { select: { bookings: true, jobs: true, invoices: true, payments: true } } } });
    if (!c) throw new ActionError("Customer not found");
    const n = c._count.bookings + c._count.jobs + c._count.invoices + c._count.payments;
    if (n > 0) throw new ActionError(`${c.name} has ${n} linked record(s) \u2014 bookings, jobs or invoices. Deactivate the customer instead, which keeps all of it.`);
    await db.customer.delete({ where: { id: customerId } });
    return { deleted: c.name };
  },
});

/* -------------------------- Services, staff, admin ------------------------- */

defineAction({
  name: "services.delete",
  description: "Delete a service never used on a booking or quote. If it has been used, deactivate it with services.update instead.",
  category: "Services", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ serviceId: z.string() }),
  handler: async ({ serviceId }) => {
    const used = await db.bookingItem.count({ where: { serviceId } }) + await db.quoteItem.count({ where: { serviceId } });
    if (used > 0) throw new ActionError(`This service is used on ${used} record(s). Deactivate it instead \u2014 it stops appearing on new bookings and the existing ones keep their prices.`);
    const s = await db.service.delete({ where: { id: serviceId } });
    return { deleted: s.name };
  },
});

defineAction({
  name: "staff.delete",
  description: "Delete a cleaner who has never been assigned a job. Otherwise deactivate them with staff.update.",
  category: "Staff", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ staffId: z.string() }),
  handler: async ({ staffId }) => {
    const used = await db.jobAssignment.count({ where: { staffId } });
    if (used > 0) throw new ActionError(`This cleaner is on ${used} job(s). Deactivate them instead \u2014 they stop appearing on new jobs and their work history is kept.`);
    const s = await db.staff.delete({ where: { id: staffId } });
    return { deleted: s.name };
  },
});

defineAction({
  name: "users.delete",
  description: "Permanently delete a user account and its login. This cannot be undone. The linked cleaner profile is kept and simply unlinked, and audit history is kept under the person's name. You cannot delete your own account, and you cannot delete the last active owner \u2014 deactivate with users.update instead when you only want to block sign-in.",
  category: "Admin", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ userId: z.string() }),
  handler: async ({ userId }, ctx) => {
    if (userId === ctx.user.id) throw new ActionError("You cannot delete your own account. Ask another owner to remove it.");
    const u = await db.user.findUnique({ where: { id: userId }, include: { staff: true } });
    if (!u) throw new ActionError("User not found");
    if (u.role === "OWNER") {
      const others = await db.user.count({ where: { role: "OWNER", active: true, id: { not: userId } } });
      if (others === 0) throw new ActionError("This is the last active owner. Promote another user to owner first, otherwise nobody could manage the system.");
    }
    // Unlink rather than cascade: the cleaner profile and their job history survive,
    // and audit rows stay readable through actorName once userId is cleared.
    if (u.staff) await db.staff.update({ where: { id: u.staff.id }, data: { userId: null } });
    await db.auditLog.updateMany({ where: { userId }, data: { userId: null } });
    await db.notification.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
    // Remove the credentials too, otherwise the address stays taken and the
    // account could still authenticate even though the app no longer knows it.
    let credentialsLeft = false;
    if (u.authUserId) {
      const { deleteAuthUser } = await import("../supabase/admin");
      credentialsLeft = !(await deleteAuthUser(u.authUserId));
    }
    return {
      deleted: u.email, name: u.name, role: u.role,
      unlinkedStaff: u.staff?.name ?? null,
      ...(credentialsLeft ? { warning: `The sign-in record for ${u.email} could not be removed. Delete it in Supabase.` } : {}),
    };
  },
});

defineAction({
  name: "users.resetPassword",
  description: "Set a new password for a user account.",
  category: "Admin", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ userId: z.string(), newPassword: z.string().min(6) }),
  handler: async ({ userId, newPassword }) => {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u) throw new ActionError("User not found");
    if (!u.authUserId) {
      throw new ActionError(`${u.email} has no sign-in record yet. Recreate the account so it gets one.`);
    }
    const { setAuthPassword } = await import("../supabase/admin");
    await setAuthPassword(u.authUserId, newPassword);
    return { updated: u.email };
  },
});

defineAction({
  name: "notifications.markRead",
  description: "Mark notifications as read for the signed-in user — one by id, or all of them.",
  category: "Notifications", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ notificationId: optionalId().describe("Omit to mark every notification read") }),
  handler: async ({ notificationId }, ctx) => ({ read: await setReceipts(ctx.user.id, { read: true }, notificationId) }),
});

defineAction({
  name: "notifications.dismiss",
  description: "Clear notifications from the signed-in user's bell — one by id, or all of them. Other users still see theirs.",
  category: "Notifications", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ notificationId: optionalId().describe("Omit to clear every notification") }),
  handler: async ({ notificationId }, ctx) => ({ dismissed: await setReceipts(ctx.user.id, { dismissed: true }, notificationId) }),
});

defineAction({
  name: "expenses.deleteCategory",
  description: "Delete an expense category that has no expenses filed against it.",
  category: "Expenses", roles: [...ADMIN], requiresConfirm: true,
  input: z.object({ categoryId: z.string() }),
  handler: async ({ categoryId }) => {
    const used = await db.expense.count({ where: { categoryId } });
    if (used > 0) throw new ActionError(`${used} expense(s) use this category`);
    const c = await db.expenseCategory.delete({ where: { id: categoryId } });
    return { deleted: c.name };
  },
});
