import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

/** Next to the database; see the notifications route. */
export const preferredRegion = "sin1";

/**
 * The signed-in person's assistant conversations, most recently used first.
 * `?q=` narrows to conversations whose title or any message mentions it.
 */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim();
  let ids: string[] | undefined;
  if (q) {
    // ChatMessage carries no owner, so match messages first and then keep only
    // threads that belong to this person.
    const hits = await db.chatMessage.findMany({
      where: { role: { in: ["user", "assistant"] }, content: { contains: q, mode: "insensitive" } },
      select: { threadId: true }, distinct: ["threadId"], take: 500,
    });
    ids = hits.map((h) => h.threadId);
  }
  const threads = await db.chatThread.findMany({
    where: { userId: user.id, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { id: { in: ids } }] } : {}) },
    orderBy: { updatedAt: "desc" }, take: 200,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, threads });
}
