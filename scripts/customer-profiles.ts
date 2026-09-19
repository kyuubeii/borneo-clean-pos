/**
 * Contact details for the customers in the transaction log, taken from the
 * old app at borneoclean.vercel.app (Customers -> Edit).
 *
 *   npm run import:customers -- --yes
 *
 * Safe to run more than once: it fills blanks and never overwrites something
 * that is already there. The transaction importer calls it too, so a full
 * reset + re-import reproduces the same contact details.
 */
import { PrismaClient } from "@prisma/client";

import profiles from "./customer-profiles.json";

type Profile = { name: string; phone?: string; address?: string; source?: string; note?: string };

const isLink = (s: string) => /^https?:\/\//i.test(s);

export async function applyCustomerProfiles(db: PrismaClient) {
  const missing: string[] = [];
  let phones = 0, addresses = 0, notes = 0;

  for (const p of profiles as Profile[]) {
    const c = await db.customer.findFirst({ where: { name: p.name }, include: { addresses: true } });
    if (!c) { missing.push(p.name); continue; }

    // Keep whatever is already on the record — these are additions, not a replacement.
    const extra = [p.note, p.source ? `Source: ${p.source}.` : null]
      .filter((t): t is string => !!t && !(c.notes ?? "").includes(t));
    const note = [c.notes, ...extra].filter(Boolean).join(" ") || null;

    if (!c.phone && p.phone) phones++;
    if (note !== c.notes) notes++;
    await db.customer.update({ where: { id: c.id }, data: { phone: c.phone ?? p.phone ?? null, notes: note } });

    // The structured Urban Residence addresses we already hold are better than the
    // old app's free text, so only add an address where there is none.
    if (p.address && c.addresses.length === 0) {
      await db.address.create({ data: {
        customerId: c.id,
        label: isLink(p.address) ? "Map pin" : "Home",
        line1: p.address,
        isPrimary: true,
      } });
      addresses++;
    }
  }

  if (missing.length) {
    throw new Error(`No customer matches these profile names: ${missing.join(", ")}. Fix scripts/customer-profiles.json.`);
  }
  const named = new Set((profiles as Profile[]).map((p) => p.name));
  const uncovered = (await db.customer.findMany({ select: { name: true } }))
    .map((c) => c.name).filter((n) => !named.has(n));
  if (uncovered.length) console.log(`  no contact details on file for: ${uncovered.join(", ")}`);

  console.log(`  contact details: ${phones} phone numbers, ${addresses} addresses, ${notes} notes`);
}

if (process.argv[1]?.endsWith("customer-profiles.ts")) {
  const db = new PrismaClient();
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes.\n\n  npm run import:customers -- --yes\n");
    process.exit(1);
  }
  applyCustomerProfiles(db)
    .then(() => console.log("Done."))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
