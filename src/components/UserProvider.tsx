"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/auth";

export type CurrentUser = { id: string; name: string; role: Role; staffId: string | null };
const Ctx = createContext<CurrentUser>({ id: "", name: "", role: "STAFF", staffId: null });

export const UserProvider = ({ user, children }: { user: CurrentUser; children: ReactNode }) => (
  <Ctx.Provider value={user}>{children}</Ctx.Provider>
);
export const useCurrentUser = () => useContext(Ctx);
export const useIsStaff = () => useContext(Ctx).role === "STAFF";

/**
 * True when the signed-in user may run an action with this role list.
 *
 * Every action in the registry declares its own roles and they are not uniform
 * -- deleting a customer, an invoice or a payment is OWNER-only, while most
 * edits are open to ADMIN as well. Buttons are gated with the same list the
 * action declares, so an admin is never offered something that will come back
 * as "your role cannot perform that".
 *
 * This is presentation only. runAction re-checks the role server-side, which is
 * where the decision actually binds.
 */
export const useCan = (roles: readonly Role[]) => roles.includes(useContext(Ctx).role);

/** Role lists mirroring the registry, so a button and its action cannot drift apart. */
export const ADMIN_UP = ["OWNER", "ADMIN"] as const satisfies readonly Role[];
export const OWNER_ONLY = ["OWNER"] as const satisfies readonly Role[];
