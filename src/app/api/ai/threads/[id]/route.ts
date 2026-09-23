import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { resolveAction } from "@/lib/actions";
import { toDisplay } from "@/lib/chat";

/** Next to the database; see the notifications route. */
export const preferredRegion = "sin1";

type Params = { params: Promise<{ id: string }> };

/** The thread, if it exists and belongs to the signed-in person. */
async function owned(id: string) {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }) };
  const thread = await db.chatThread.findUnique({ where: { id } });
  if (!thread || thread.userId !== user.id) return { error: NextResponse.json({ ok: false, error: "That conversation no longer exists." }, { status: 404 }) };
  return { thread };
}

/** A past conversation, as the chat panel shows it. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { thread, error } = await owned(id);
  if (error) return error;
  const rows = await db.chatMessage.findMany({
    where: { threadId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, content: true, toolCalls: true },
  });
  const messages = toDisplay(rows, (tool) => resolveAction(tool)?.name ?? tool);
  return NextResponse.json({ ok: true, thread: { id: thread!.id, title: thread!.title, updatedAt: thread!.updatedAt }, messages });
}

/** Rename. Renaming does not move the conversation up the list. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await owned(id);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const title = String(body?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!title) return NextResponse.json({ ok: false, error: "Give the conversation a name." }, { status: 400 });
  const t = await db.chatThread.update({ where: { id }, data: { title }, select: { id: true, title: true } });
  return NextResponse.json({ ok: true, thread: t });
}

/** Delete the conversation and every message in it. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await owned(id);
  if (error) return error;
  // ChatMessage.threadId is not a foreign key, so nothing cascades on its own.
  await db.$transaction([
    db.chatMessage.deleteMany({ where: { threadId: id } }),
    db.chatThread.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
