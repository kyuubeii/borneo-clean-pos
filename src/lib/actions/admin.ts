import { z } from "zod";
import { db } from "../db";
import { optionalId } from "../schema";
import { defineAction, ActionError } from "../registry";
import { createAuthUser, deleteAuthUser } from "../supabase/admin";
import { schedulePush } from "../push";
import { REMINDER_DAYS } from "../reminders";

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

/**
 * Settings are stored as text in the forms the screens write. The assistant may
 * send a number, a boolean or a list, or "1, 3 days"; each is put in the
 * stored form, and a value the app could not read is refused.
 */
function settingValue(key: string, raw: unknown): string {
  if (key === "reminders.days") {
    const days = [...new Set((Array.isArray(raw) ? raw : String(raw).match(/\d+/g) ?? []).map(Number))].sort((a, b) => a - b);
    const bad = days.filter((d) => !(REMINDER_DAYS as readonly number[]).includes(d));
    if (bad.length) throw new ActionError(`Booking reminders can be ${REMINDER_DAYS.join(" or ")} days before, not ${bad.join(", ")}.`);
    return days.join(",");
  }
  if (key === "invoice.dueDays" || key === "invoice.taxRateBp") {
    // A cleared field stays cleared, so the default applies, rather than becoming 0.
    if (String(raw).trim() === "") return "";
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new ActionError(`${key} must be a whole number.`);
    return String(n);
  }
  if (key.startsWith("notify.")) return String(raw === true || String(raw).toLowerCase() === "true");
  return Array.isArray(raw) ? raw.join(",") : String(raw);
}

defineAction({
  name: "settings.update",
  description: "Update one or more business settings. Keys: business.name, business.tagline, business.phone, business.email, business.address, business.regNo, business.bank, business.accountName, business.accountNumber; invoice.dueDays (days), invoice.taxRateBp (basis points, 600 is 6%), invoice.paymentTerms, invoice.footer, quote.paymentTerms; notify.bookingConfirmation and notify.paymentReminders (\"true\"/\"false\"); reminders.days: which booking reminders go out, \"1\" (day before), \"3\" (3 days before), \"1,3\" (both) or \"\" (none); ai.model.",
  category: "Settings", roles: ["OWNER", "ADMIN"],
  input: z.object({ values: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.number())])).describe("Map of setting key to value, e.g. {\"reminders.days\": \"1,3\"}") }),
  handler: async ({ values }) => {
    const saved: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      const value = settingValue(key, raw);
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
      saved[key] = value;
    }
    return { updated: Object.keys(saved).length, saved };
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
  handler: async (i) => {
    const row = await db.notification.create({ data: i });
    schedulePush(row.id);
    return row;
  },
});
