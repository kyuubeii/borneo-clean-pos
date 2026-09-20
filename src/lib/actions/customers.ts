import { z } from "zod";
import { db } from "../db";
import { defineAction, ActionError } from "../registry";

const ALL = ["OWNER", "ADMIN"] as const;

defineAction({
  name: "customers.search",
  description: "Search customers by name, email, phone or company. Returns matching customer profiles with their addresses. Use this first whenever a request names a customer.",
  category: "Customers", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ query: z.string().optional().describe("Free text to match against name, email, phone or company"),
    limit: z.number().int().min(1).max(50).default(20),
    includeInactive: z.boolean().default(false).describe("Deactivated customers are left out unless this is true") }),
  handler: async ({ query, limit, includeInactive }) => {
    // Deactivating a customer is supposed to keep them off new bookings, and the
    // booking and quote forms both fill their dropdown from here. Matches how
    // staff.list and services.list already behave.
    const active = includeInactive ? {} : { active: true };
    const where = query ? { ...active, OR: [
      { name: { contains: query } }, { email: { contains: query } },
      { phone: { contains: query } }, { company: { contains: query } },
    ] } : active;
    const rows = await db.customer.findMany({ where, take: limit, orderBy: { name: "asc" }, include: { addresses: true } });
    return rows.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company, notes: c.notes,
      // The customers screen shows and toggles this, so it has to come back.
      active: c.active,
      addresses: c.addresses.map((a) => ({ id: a.id, label: a.label, line1: a.line1, city: a.city })) }));
  },
});

defineAction({
  name: "customers.get",
  description: "Get one customer's full record: contact details, addresses, bookings, jobs, invoices and payment history.",
  category: "Customers", roles: ["OWNER", "ADMIN"], readOnly: true,
  input: z.object({ customerId: z.string() }),
  handler: async ({ customerId }) => {
    const c = await db.customer.findUnique({ where: { id: customerId }, include: {
      addresses: true,
      bookings: { orderBy: { startAt: "desc" }, take: 20 },
      jobs: { orderBy: { scheduledAt: "desc" }, take: 20 },
      invoices: { orderBy: { issuedAt: "desc" }, include: { payments: true, items: true } },
      payments: { orderBy: { paidAt: "desc" }, take: 20 },
    } });
    if (!c) throw new ActionError("Customer not found");
    return c;
  },
});

defineAction({
  name: "customers.create",
  description: "Create a new customer, optionally with their first service address.",
  category: "Customers", roles: [...ALL],
  input: z.object({
    name: z.string().min(1), email: z.string().optional(), phone: z.string().optional(),
    company: z.string().optional(), notes: z.string().optional(),
    address: z.object({ label: z.string().default("Home"), line1: z.string(), line2: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(), postcode: z.string().optional(),
      accessNotes: z.string().optional() }).optional(),
  }),
  handler: async (i) => db.customer.create({
    data: { name: i.name, email: i.email, phone: i.phone, company: i.company, notes: i.notes,
      addresses: i.address ? { create: { ...i.address, isPrimary: true } } : undefined },
    include: { addresses: true },
  }),
});

defineAction({
  name: "customers.update",
  description: "Update a customer's contact details or notes.",
  category: "Customers", roles: [...ALL],
  input: z.object({ customerId: z.string(), name: z.string().optional(), email: z.string().optional(),
    phone: z.string().optional(), company: z.string().optional(), notes: z.string().optional(), active: z.boolean().optional() }),
  handler: async ({ customerId, ...data }) => db.customer.update({ where: { id: customerId }, data }),
});

defineAction({
  name: "customers.addAddress",
  description: "Add another service address to an existing customer.",
  category: "Customers", roles: [...ALL],
  input: z.object({ customerId: z.string(), label: z.string().default("Site"), line1: z.string(),
    line2: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    postcode: z.string().optional(), accessNotes: z.string().optional(), isPrimary: z.boolean().default(false) }),
  handler: async ({ customerId, ...a }) => {
    if (a.isPrimary) await db.address.updateMany({ where: { customerId }, data: { isPrimary: false } });
    return db.address.create({ data: { customerId, ...a } });
  },
});

defineAction({
  name: "customers.lapsed",
  description: "Find customers who have not booked within a given number of days. Use for questions like 'who hasn't booked with us in the last 3 months'.",
  category: "Customers", roles: [...ALL], readOnly: true,
  input: z.object({ days: z.number().int().min(1).default(90) }),
  handler: async ({ days }) => {
    const cutoff = new Date(Date.now() - days * 86400000);
    const rows = await db.customer.findMany({ where: { active: true }, include: { bookings: { orderBy: { startAt: "desc" }, take: 1 } } });
    return rows
      .filter((c) => !c.bookings[0] || c.bookings[0].startAt < cutoff)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email,
        lastBooking: c.bookings[0]?.startAt ?? null,
        daysSince: c.bookings[0] ? Math.floor((Date.now() - c.bookings[0].startAt.getTime()) / 86400000) : null }))
      .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
  },
});
