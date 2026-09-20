import { z } from "zod";
import { db } from "../db";
import { defineAction } from "../registry";

defineAction({
  name: "services.list",
  description: "List the service catalogue with prices and durations. Includes add-ons when requested.",
  category: "Services", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ query: z.string().optional(), includeInactive: z.boolean().default(false), addonsOnly: z.boolean().optional() }),
  handler: async ({ query, includeInactive, addonsOnly }) => db.service.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(addonsOnly === undefined ? {} : { isAddon: addonsOnly }),
      ...(query ? { OR: [{ name: { contains: query } }, { category: { contains: query } }] } : {}),
    },
    orderBy: [{ isAddon: "asc" }, { category: "asc" }, { name: "asc" }],
  }),
});

defineAction({
  name: "services.create",
  description: "Add a new service or add-on to the catalogue.",
  category: "Services", roles: ["OWNER", "ADMIN"],
  input: z.object({
    name: z.string().min(1), nameZh: z.string().optional(), description: z.string().optional(),
    category: z.string().default("General"),
    priceCents: z.number().int().min(0).describe("Price in cents, e.g. RM 150.00 is 15000"),
    priceType: z.enum(["FLAT", "HOURLY", "SQFT"]).default("FLAT"),
    durationMin: z.number().int().min(15).default(120),
    materialCostCents: z.number().int().min(0).default(0),
    isAddon: z.boolean().default(false),
  }),
  handler: async (i) => db.service.create({ data: i }),
});

defineAction({
  name: "services.update",
  description: "Update a service's pricing, duration or availability.",
  category: "Services", roles: ["OWNER", "ADMIN"],
  input: z.object({ serviceId: z.string(), name: z.string().optional(), priceCents: z.number().int().optional(),
    durationMin: z.number().int().optional(), materialCostCents: z.number().int().optional(),
    category: z.string().optional(), description: z.string().optional(), active: z.boolean().optional() }),
  handler: async ({ serviceId, ...data }) => db.service.update({ where: { id: serviceId }, data }),
});
