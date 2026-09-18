import { z } from "zod";
import { db } from "../db";
import { optionalId, nullableId, optionalText } from "../schema";
import { defineAction, ActionError } from "../registry";
import { totals } from "../money";

const ADMIN = ["OWNER", "ADMIN"] as const;

/* ------------------------------- Bookings --------------------------------- */

defineAction({
  name: "bookings.update",
  description: "Edit an existing booking: its services, notes, address or duration. To change the date/time use bookings.reschedule instead.",
  category: "Bookings", roles: [...ADMIN],
  input: z.object({
    bookingId: z.string(),
    serviceIds: z.array(z.string()).optional().describe("Replaces the whole service list; also updates the job's revenue"),
    addressId: optionalId(), notes: z.string().optional(),
    internalNotes: z.string().optional(), durationMin: z.number().int().min(15).optional(),
  }),
  handler: async ({ bookingId, serviceIds, ...rest }) => {
    const b = await db.booking.findUnique({ where: { id: bookingId }, include: { job: true } });
    if (!b) throw new ActionError("Booking not found");
    if (serviceIds) {
      const services = await db.service.findMany({ where: { id: { in: serviceIds } } });
      if (services.length !== serviceIds.length) throw new ActionError("One or more services not found");
      await db.bookingItem.deleteMany({ where: { bookingId } });
      await db.bookingItem.createMany({ data: services.map((s) => ({ bookingId, serviceId: s.id, qty: 1, priceCents: s.priceCents, name: s.name })) });
      const revenue = services.reduce((a, s) => a + s.priceCents, 0);
      const material = services.reduce((a, s) => a + s.materialCostCents, 0);
      const duration = rest.durationMin ?? services.reduce((a, s) => a + s.durationMin, 0);
      if (b.job) await db.job.update({ where: { id: b.job.id }, data: { revenueCents: revenue, materialCostCents: material, durationMin: duration } });
      rest.durationMin = duration;
    }
    return db.booking.update({ where: { id: bookingId }, data: rest, include: { items: true, customer: true } });
  },
});

/* --------------------------------- Jobs ----------------------------------- */

defineAction({
  name: "jobs.addChecklistItem",
  description: "Add a single item to a job's checklist without replacing the existing ones.",
  category: "Jobs", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ jobId: z.string(), label: z.string().min(1) }),
  handler: async ({ jobId, label }) => {
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

/* -------------------------------- Quotes ---------------------------------- */

defineAction({
  name: "quotes.get",
  description: "Get one quotation in full, including every line item and the calculated totals.",
  category: "Quotes", roles: [...ADMIN], readOnly: true,
  input: z.object({ quoteId: z.string() }),
  handler: async ({ quoteId }) => {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { customer: true, items: true } });
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
    if (q.convertedBookingId) throw new ActionError("This quote has already been converted to a booking and cannot be edited");
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
    if (q.convertedBookingId) throw new ActionError("This quote has been converted to a booking; cancel the booking instead");
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
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!inv) throw new ActionError("Invoice not found");
    if (items && inv.payments.length) throw new ActionError(`Invoice ${inv.ref} already has payments recorded; void it and raise a new one instead`);
    if (items) {
      await db.invoiceItem.deleteMany({ where: { invoiceId } });
      await db.invoiceItem.createMany({ data: items.map((i) => ({ ...i, invoiceId })) });
    }
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
    if (inv.payments.length) throw new ActionError(`Invoice ${inv.ref} has payments recorded and cannot be deleted; void it instead`);
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
    if (p.invoiceId && p.invoice) {
      const rest = p.invoice.payments.filter((x) => x.id !== paymentId);
      const t = totals(p.invoice.items, p.invoice.discountCents, p.invoice.taxRateBp);
      const paid = rest.reduce((a, x) => a + (x.isRefund ? -x.amountCents : x.amountCents), 0);
      await db.invoice.update({ where: { id: p.invoiceId },
        data: { status: paid <= 0 ? "SENT" : paid >= t.total ? "PAID" : "PARTIAL" } });
    }
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
    categoryName: optionalText(), vendor: z.string().optional(), note: z.string().optional(),
    spentAt: z.string().optional(), jobId: nullableId(),
    reimbursable: z.boolean().optional(),
  }),
  handler: async ({ expenseId, categoryName, spentAt, ...rest }) => {
    let categoryId: string | undefined;
    if (categoryName) {
      const c = await db.expenseCategory.upsert({ where: { name: categoryName }, update: {}, create: { name: categoryName } });
      categoryId = c.id;
    }
    return db.expense.update({ where: { id: expenseId },
      data: { ...rest, ...(categoryId ? { categoryId } : {}), ...(spentAt ? { spentAt: new Date(spentAt) } : {}) },
      include: { category: true } });
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
  input: z.object({ addressId: z.string(), label: z.string().optional(), line1: z.string().optional(),
    line2: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    postcode: z.string().optional(), accessNotes: z.string().optional(), isPrimary: z.boolean().optional() }),
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
    const used = await db.booking.count({ where: { addressId } }) + await db.job.count({ where: { addressId } });
    if (used > 0) throw new ActionError(`This address is used by ${used} booking(s)/job(s) and cannot be removed`);
    await db.address.delete({ where: { id: addressId } });
    return { deleted: addressId };
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
    if (n > 0) throw new ActionError(`${c.name} has ${n} linked record(s). Deactivate instead of deleting to preserve history.`);
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
    if (used > 0) throw new ActionError(`This service is used on ${used} record(s). Set active:false with services.update instead.`);
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
    if (used > 0) throw new ActionError(`This cleaner is on ${used} job(s). Set active:false with staff.update instead.`);
    const s = await db.staff.delete({ where: { id: staffId } });
    return { deleted: s.name };
  },
});

defineAction({
  name: "users.resetPassword",
  description: "Set a new password for a user account.",
  category: "Admin", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ userId: z.string(), newPassword: z.string().min(6) }),
  handler: async ({ userId, newPassword }) => {
    const { hashPassword } = await import("../auth");
    const u = await db.user.update({ where: { id: userId }, data: { password: hashPassword(newPassword) } });
    return { updated: u.email };
  },
});

defineAction({
  name: "notifications.markRead",
  description: "Mark notifications as read — one by id, or all of them.",
  category: "Notifications", roles: ["OWNER", "ADMIN", "STAFF"],
  input: z.object({ notificationId: optionalId().describe("Omit to mark every notification read") }),
  handler: async ({ notificationId }, ctx) => {
    if (notificationId) { await db.notification.update({ where: { id: notificationId }, data: { read: true } }); return { read: 1 }; }
    const r = await db.notification.updateMany({ where: { OR: [{ userId: null }, { userId: ctx.user.id }], read: false }, data: { read: true } });
    return { read: r.count };
  },
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
