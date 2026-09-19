/**
 * Wipe operational data and start fresh.
 *
 *   npm run reset -- --yes                     keep the service catalogue and
 *                                              expense categories as a template
 *   npm run reset -- --yes --all               also clear the catalogue
 *   npm run reset -- --yes --keep-profile      keep the business profile text
 *
 * Always kept: user accounts (so you are never locked out) and the OpenRouter
 * API key and model, which are credentials/config rather than business data.
 */
import { PrismaClient } from "@prisma/client";
import { rm, mkdir } from "fs/promises";
import path from "path";

const db = new PrismaClient();
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

// Identity fields that describe a specific business; cleared unless asked otherwise.
const PROFILE_KEYS = ["business.name", "business.email", "business.phone", "business.address", "business.regNo", "invoice.footer"];
// Credentials and config that must survive any reset.
const PROTECTED_KEYS = ["ai.apiKey", "ai.model"];

async function main() {
  if (!has("--yes")) {
    console.error("Refusing to run without --yes.\n\n  npm run reset -- --yes [--all] [--keep-profile]\n");
    process.exit(1);
  }
  const clearCatalogue = has("--all");
  const keepProfile = has("--keep-profile");

  // Order matters: children before parents, so foreign keys never block a delete.
  const ORDER = [
    "chatMessage", "auditLog", "notification", "payout", "expense", "payment",
    "invoiceItem", "invoice", "quoteItem", "quote", "timeEntry", "photo",
    "checklistItem", "jobAssignment", "job", "bookingItem", "booking",
    "address", "customer", "availability", "staff",
  ];
  console.log("Clearing operational data…");
  for (const m of ORDER) {
    const r = await (db as any)[m].deleteMany();
    if (r.count) console.log(`  ${m}: ${r.count}`);
  }

  if (clearCatalogue) {
    const s = await db.service.deleteMany();
    const c = await db.expenseCategory.deleteMany();
    console.log(`  services: ${s.count}\n  expenseCategory: ${c.count}`);
  } else {
    console.log(`Kept as a template: ${await db.service.count()} services, ${await db.expenseCategory.count()} expense categories`);
  }

  if (!keepProfile) {
    for (const k of PROFILE_KEYS) {
      await db.setting.upsert({ where: { key: k }, update: { value: "" }, create: { key: k, value: "" } });
    }
    console.log("Business profile blanked — fill it in under Settings.");
  }

  // Sensible operating defaults, so a fresh install is usable immediately.
  const DEFAULTS: Record<string, string> = {
    "invoice.taxRateBp": "0", "invoice.dueDays": "14",
    "notify.bookingConfirmation": "true", "notify.reminders": "true", "notify.paymentReminders": "true",
  };
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await db.setting.upsert({ where: { key: k }, update: {}, create: { key: k, value: v } });
  }

  // Uploaded photos and receipts belong to the records we just removed.
  const uploads = path.join(process.cwd(), "public", "uploads");
  await rm(uploads, { recursive: true, force: true });
  await mkdir(uploads, { recursive: true });
  console.log("Uploaded files cleared.");

  const users = await db.user.findMany({ select: { email: true, role: true, active: true } });
  const keptKeys = await db.setting.findMany({ where: { key: { in: PROTECTED_KEYS } } });
  console.log(`\nAccounts kept (${users.length}):`);
  for (const u of users) console.log(`  ${u.role} ${u.email}${u.active ? "" : " (inactive)"}`);
  console.log(`Kept config: ${keptKeys.map((k) => k.key).join(", ") || "none"}`);
  console.log("\nFresh start ready.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
