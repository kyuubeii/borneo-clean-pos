/**
 * One-off copy of the SQLite dev.db into Supabase Postgres.
 *
 * Reads through a second Prisma client generated from prisma/sqlite.prisma so
 * both databases can be open at once, and writes through the normal client.
 * Rows keep their existing ids, so every foreign key still points where it did.
 *
 * The SQLite client is not built by `postinstall`, which only generates the
 * default schema, so generate it first:
 *
 *   npx prisma generate --schema prisma/sqlite.prisma
 *   SQLITE_URL="file:./prisma/dev.db" DATABASE_URL="postgresql://..." \
 *     npx tsx scripts/migrate-to-postgres.ts
 *
 * Refuses to run if the target already holds data, unless --force is passed.
 *
 * AFTERWARDS, RESET THE OWNER PASSWORD. hashPassword() in src/lib/auth.ts
 * salts with SESSION_SECRET, and these rows were hashed against the fallback
 * value because SESSION_SECRET was never set locally. Once a real secret is
 * set in production the stored hash no longer matches anything, and the only
 * account cannot sign in. Row counts will still match -- this script cannot
 * detect it. With the production SESSION_SECRET and DATABASE_URL set:
 *
 *   npm run user:password -- <email> <new-password>
 *
 * Do not work around this by setting SESSION_SECRET to the fallback string:
 * it is committed in this repository, and it also signs session cookies.
 */
import { PrismaClient as SqliteClient } from ".prisma-sqlite/client";
import { PrismaClient as PgClient } from "@prisma/client";

const sqlite = new SqliteClient();
const pg = new PgClient();

/**
 * Parents before children: every model appears after the models its foreign
 * keys point at, so Postgres never sees a reference it cannot resolve.
 */
const ORDER = [
  "user", "staff", "availability",
  "customer", "address", "service",
  "booking", "bookingItem",
  // Invoice comes before Job: a Job carries an optional invoiceId, not the
  // other way round, so the invoice has to exist first.
  "invoice", "invoiceItem",
  "job", "jobAssignment", "checklistItem", "photo", "timeEntry",
  "quote", "quoteItem", "payment",
  "expenseCategory", "expense", "payout",
  "notification", "auditLog", "setting", "chatMessage", "capitalEntry",
] as const;

/** Booking.parentId points at another Booking, so it is filled in afterwards. */
const SELF_REFS: Record<string, string> = { booking: "parentId" };

async function main() {
  const force = process.argv.includes("--force");

  const existing: string[] = [];
  for (const model of ORDER) {
    const n = await (pg as any)[model].count();
    if (n > 0) existing.push(`${model}=${n}`);
  }
  if (existing.length && !force) {
    console.error("Target database is not empty:", existing.join(" "));
    console.error("Re-run with --force only if you mean to add to it.");
    process.exit(1);
  }

  const deferred: Array<{ model: string; id: string; field: string; value: string }> = [];
  const counts: Array<[string, number, number]> = [];

  for (const model of ORDER) {
    const rows: any[] = await (sqlite as any)[model].findMany();
    const selfRef = SELF_REFS[model];

    const payload = rows.map((row) => {
      if (selfRef && row[selfRef]) {
        deferred.push({ model, id: row.id, field: selfRef, value: row[selfRef] });
        return { ...row, [selfRef]: null };
      }
      return row;
    });

    if (payload.length) {
      await (pg as any)[model].createMany({ data: payload });
    }

    const written = await (pg as any)[model].count();
    counts.push([model, rows.length, written]);
    console.log(`${model.padEnd(18)} read ${String(rows.length).padStart(5)}  ->  ${written}`);
  }

  for (const d of deferred) {
    await (pg as any)[d.model].update({ where: { id: d.id }, data: { [d.field]: d.value } });
  }
  if (deferred.length) console.log(`\nre-linked ${deferred.length} self-reference(s)`);

  const mismatched = counts.filter(([, read, written]) => read !== written);
  if (mismatched.length) {
    console.error("\nRow counts do not match:");
    for (const [m, r, w] of mismatched) console.error(`  ${m}: read ${r}, wrote ${w}`);
    process.exit(1);
  }

  const total = counts.reduce((s, [, r]) => s + r, 0);
  console.log(`\nAll ${counts.length} tables match. ${total} rows copied.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await sqlite.$disconnect();
    await pg.$disconnect();
  });
