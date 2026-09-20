import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { runAction, getAction } from "@/lib/actions";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

const Body = z.object({
  calls: z.array(z.object({ name: z.string(), input: z.unknown().optional() })).min(1).max(25),
});

/**
 * Runs several read-only actions under a single request.
 *
 * A page like the dashboard asks for six things at once. One request each meant
 * six authentication round trips and six lots of connection contention for what
 * is really one screen of data; this pays that cost once.
 *
 * Writes are deliberately refused. They keep going to /api/actions/<name> one at
 * a time, so a write and a read issued in the same tick can never be reordered
 * against each other and a read can never observe half-applied state.
 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON", code: "INVALID_INPUT" }, { status: 400 }); }

  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Expected { calls: [{ name, input }] }", code: "INVALID_INPUT" }, { status: 400 });

  const results = await Promise.all(parsed.data.calls.map(async (c) => {
    const action = getAction(c.name);
    if (!action) return { ok: false as const, error: `Unknown action: ${c.name}`, code: "NOT_FOUND" };
    if (!action.readOnly) return { ok: false as const, error: `"${c.name}" is not read-only and cannot be batched.`, code: "NOT_BATCHABLE" };
    return runAction(c.name, c.input ?? {}, { user, source: "ui" });
  }));

  // 200 even when individual calls failed: each result carries its own ok flag,
  // so one bad action does not take the other five down with it.
  return NextResponse.json({ ok: true, results });
}
