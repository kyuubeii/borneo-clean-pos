import { cookies } from "next/headers";
import crypto from "crypto";
import { db } from "./db";

export type Role = "OWNER" | "ADMIN" | "STAFF";
export type SessionUser = { id: string; name: string; email: string; role: Role; staffId?: string | null };

const SECRET = process.env.SESSION_SECRET || "borneo-clean-dev-secret";
export const hashPassword = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

function sign(v: string) {
  return v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("hex").slice(0, 32);
}
function unsign(v: string | undefined): string | null {
  if (!v) return null;
  const i = v.lastIndexOf(".");
  if (i < 0) return null;
  const body = v.slice(0, i);
  return sign(body) === v ? body : null;
}

export async function createSession(userId: string) {
  (await cookies()).set("bc_session", sign(userId), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function destroySession() {
  (await cookies()).delete("bc_session");
}

export async function getUser(): Promise<SessionUser | null> {
  const id = unsign((await cookies()).get("bc_session")?.value);
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, include: { staff: true } });
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, staffId: u.staff?.id ?? null };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}

const RANK: Record<Role, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
/** True when the user's role is included in the allowed list. */
export const can = (user: { role: Role } | null, roles: Role[]) => !!user && roles.includes(user.role);
export const atLeast = (user: { role: Role } | null, role: Role) => !!user && RANK[user.role] >= RANK[role];
