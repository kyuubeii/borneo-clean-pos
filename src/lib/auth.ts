import { cache } from "react";
import crypto from "crypto";
import { db } from "./db";
import { supabaseServer, authConfigured } from "./supabase/server";

export type Role = "OWNER" | "ADMIN" | "STAFF";
export type SessionUser = { id: string; name: string; email: string; role: Role; staffId?: string | null };

const SECRET = process.env.SESSION_SECRET || "borneo-clean-dev-secret";

/**
 * Legacy sha256 hash, kept only so the old User.password column still has a
 * meaning if this migration is rolled back. Sign-in no longer consults it --
 * Supabase Auth holds the credentials and hashes them with bcrypt.
 *
 * @deprecated Use Supabase Auth. Nothing should call this for new passwords.
 */
export const hashPassword = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

/**
 * The signed-in user, or null.
 *
 * Identity comes from Supabase Auth; role, name and the staff link stay in the
 * app's own User table, keyed by authUserId. cache() keeps this to a single
 * auth round-trip per request, since the layout and the page both ask.
 */
export const getUser = cache(async function getUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const u = await db.user.findUnique({
    where: { authUserId: data.user.id },
    include: { staff: true },
  });
  if (!u || !u.active) return null;

  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, staffId: u.staff?.id ?? null };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}

const RANK: Record<Role, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
/** True when the user's role is included in the allowed list. */
export const can = (user: { role: Role } | null, roles: Role[]) => !!user && roles.includes(user.role);
export const atLeast = (user: { role: Role } | null, role: Role) => !!user && RANK[user.role] >= RANK[role];
