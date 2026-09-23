/**
 * Give conversations saved before chat history existed a ChatThread row, so
 * they show up in the assistant's history list.
 *
 * ChatMessage never recorded who was talking, so these are assigned to one
 * account: the first owner by default, or the email passed as an argument.
 * Titles come from each conversation's first message. Safe to re-run: a
 * thread that already has a row is left alone.
 *
 *   npx tsx scripts/backfill-chat-threads.ts [owner-email]
 */
import { PrismaClient } from "@prisma/client";
import { titleFrom } from "../src/lib/chat";

const db = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const owner = await db.user.findFirst({
    where: email ? { email } : { role: "OWNER", active: true }, orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error(email ? `No user with email ${email}` : "No active owner account");

  const groups = await db.chatMessage.groupBy({
    by: ["threadId"], _min: { createdAt: true }, _max: { createdAt: true },
  });
  const existing = new Set((await db.chatThread.findMany({ select: { id: true } })).map((t) => t.id));
  let made = 0;
  for (const g of groups) {
    if (existing.has(g.threadId)) continue;
    const first = await db.chatMessage.findFirst({
      where: { threadId: g.threadId, role: "user" }, orderBy: { createdAt: "asc" }, select: { content: true },
    });
    await db.chatThread.create({ data: {
      id: g.threadId, userId: owner.id, title: titleFrom(first?.content ?? ""),
      createdAt: g._min.createdAt ?? new Date(), updatedAt: g._max.createdAt ?? new Date(),
    } });
    made++;
  }
  console.log(`${made} conversation(s) given to ${owner.email}; ${groups.length - made} already had a history entry.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
