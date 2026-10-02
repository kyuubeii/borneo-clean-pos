import { PrismaClient } from "@prisma/client";
import { useBusinessClock } from "./clock";
// Also done at start-up (instrumentation.ts); here too so scripts and any path
// that reaches the database is on the Kuching clock as well.
useBusinessClock();
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
