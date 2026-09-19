import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { createAuthUser, deleteAuthUser } from "../supabase/admin";

defineAction({
  name: "settings.get",
  description: "Read all business settings as a key/value map: business profile, invoice defaults, notification preferences and AI model.",
  category: "Settings", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({}),
  handler: async () => {
    const rows = await db.setting.findMany();
    const out: Record<string, string> = {};
    // The API key is never returned to the browser; only whether one is set.
    for (const r of rows) if (r.key !== "ai.apiKey") out[r.key] = r.value;
    out["ai.hasKey"] = String(!!(rows.find((r) => r.key === "ai.apiKey")?.value || process.env.OPENROUTER_API_KEY));
    return out;
  },
});

defineAction({
  name: "settings.update",
  description: "Update one or more business settings.",
  category: "Settings", roles: ["OWNER", "ADMIN"],
  input: z.object({ values: z.record(z.string()).describe("Map of setting key to value") }),
  handler: async ({ values }) => {
    for (const [key, value] of Object.entries(values)) {
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    return { updated: Object.keys(values).length };
  },
});

defineAction({
  name: "users.list",
  description: "List application user accounts and their roles.",
  category: "Admin", roles: ["OWNER"], readOnly: true,
  input: z.object({}),
  handler: async () => {
    const rows = await db.user.findMany({ orderBy: { createdAt: "asc" }, include: { staff: true } });
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
      staffName: u.staff?.name ?? null, createdAt: u.createdAt }));
  },
});

defineAction({
  name: "users.create",
  description: "Create a new user account with a role. Roles: OWNER (everything), ADMIN (operations and money), STAFF (own jobs only).",
  category: "Admin", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ name: z.string().min(1), email: z.string().min(3), password: z.string().min(6),
    role: z.enum(["OWNER", "ADMIN", "STAFF"]).default("STAFF"), staffId: optionalId() }),
  handler: async (i) => {
    const email = i.email.toLowerCase().trim();
    if (await db.user.findUnique({ where: { email } })) throw new ActionError("That email is already in use");

    // Supabase holds the credentials, this table holds the role. If the second
    // write fails the first is undone, otherwise the orphaned auth account
    // would reserve the address and block every retry.
    const authUserId = await createAuthUser(email, i.password);
    try {
      const u = await db.user.create({
        data: { name: i.name, email, password: "", authUserId, role: i.role },
      });
      if (i.staffId) await db.staff.update({ where: { id: i.staffId }, data: { userId: u.id } });
      return { id: u.id, name: u.name, email: u.email, role: u.role };
    } catch (e) {
      const cleaned = await deleteAuthUser(authUserId);
      throw new ActionError(
        cleaned
          ? `Could not create the account: ${(e as Error).message}`
          : `Could not create the account, and the sign-in record for ${email} was left behind. Remove it in Supabase before retrying.`,
      );
    }
  },
});

defineAction({
  name: "users.update",
  description: "Change a user's role or deactivate their account.",
  category: "Admin", roles: ["OWNER"], requiresConfirm: true,
  input: z.object({ userId: z.string(), role: z.enum(["OWNER", "ADMIN", "STAFF"]).optional(),
    active: z.boolean().optional(), name: z.string().optional() }),
  handler: async ({ userId, ...data }, ctx) => {
    if (userId === ctx.user.id && data.active === false) throw new ActionError("You cannot deactivate your own account");
    return db.user.update({ where: { id: userId }, data, select: { id: true, name: true, email: true, role: true, active: true } });
  },
});

defineAction({
  name: "notifications.list",
  description: "List in-app notifications.",
  category: "Notifications", roles: ["OWNER", "ADMIN", "STAFF"], readOnly: true,
  input: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().max(100).default(30) }),
  handler: async ({ unreadOnly, limit }, ctx) => db.notification.findMany({
    where: { OR: [{ userId: null }, { userId: ctx.user.id }], ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
  }),
});

defineAction({
  name: "notifications.send",
  description: "Create an in-app notification, for example a reminder for the team.",
  category: "Notifications", roles: ["OWNER", "ADMIN"],
  input: z.object({ type: z.string().default("REMINDER"), title: z.string(), body: z.string().optional(), link: z.string().optional() }),
  handler: async (i) => db.notification.create({ data: i }),
});
