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
