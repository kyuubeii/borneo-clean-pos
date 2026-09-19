/**
 * One-off: give every app user a Supabase Auth account and link the two.
 *
 * The old sha256 hashes cannot be carried over -- Supabase stores bcrypt -- so
 * each user needs a password set here, and they should change it afterwards.
 *
 *   npx tsx scripts/link-supabase-auth.ts <email> <initial-password>
 *
 * Safe to re-run: if an auth user already exists for the address it is reused
 * rather than duplicated, so a failed run does not leave an orphan that blocks
 * the email on the next attempt.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";

function loadEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const db = new PrismaClient();
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Supabase has no get-user-by-email, so page through the list. */
async function findAuthUserByEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const [rawEmail, password] = process.argv.slice(2);
  if (!rawEmail || !password) throw new Error("Usage: npx tsx scripts/link-supabase-auth.ts <email> <initial-password>");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (checked the environment and .env).");
  }
  const email = rawEmail.toLowerCase().trim();

  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No app user with email ${email}`);

  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    // Re-run, or the address already existed: reset the password rather than
    // creating a second account Supabase would reject anyway.
    const { error } = await admin.auth.admin.updateUserById(authUser.id, { password, email_confirm: true });
    if (error) throw error;
    console.log(`Reused existing auth user ${authUser.id} and reset its password.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no mail server configured; skip the confirmation round-trip
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`Created auth user ${authUser!.id}.`);
  }

  await db.user.update({ where: { id: user.id }, data: { authUserId: authUser!.id } });
  console.log(`Linked app user ${user.name} <${email}> (${user.role}) to auth user ${authUser!.id}.`);
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
