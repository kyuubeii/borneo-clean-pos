/**
 * Put the starter service catalogue back after `npm run reset -- --yes --all`.
 *
 *   npm run catalogue -- --yes
 *
 * Matches on name, so running it twice adds nothing.
 */
import { PrismaClient } from "@prisma/client";

import { catalogue, expenseCategories } from "../prisma/catalogue";

const db = new PrismaClient();

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes.\n\n  npm run catalogue -- --yes\n");
    process.exit(1);
  }
  let added = 0;
  for (const s of catalogue) {
    if (await db.service.findFirst({ where: { name: s.name } })) continue;
    await db.service.create({ data: s });
    added++;
  }
  for (const name of expenseCategories) {
    await db.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`Catalogue: ${added} services added, ${await db.service.count()} in total.`);
  console.log(`Expense categories: ${await db.expenseCategory.count()} in total.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
