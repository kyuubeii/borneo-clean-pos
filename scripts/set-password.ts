/**
 * Command-line password reset — the way back in when nobody can sign in.
 *
 * The app has no self-service reset: users.resetPassword needs an owner who is
 * already signed in, so a single locked-out owner would have no route back.
 *
 *   npm run user:password -- <email>
 *   npm run user:password -- <email> --email <new-login-email>
 *
 * Prompts for the password without echoing it.
 *
 * Credentials live in Supabase Auth, so this writes there, not to the User
 * table -- the password column is legacy and no longer consulted at sign-in.
 * Changing the login address updates both sides, since they are linked by
 * authUserId rather than by email.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { Writable } from "stream";
import { createClient } from "@supabase/supabase-js";

/** Minimal .env reader — the project has no dotenv dependency. */
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

/**
 * Reads a line with the echo suppressed. readline echoes through its output
 * stream, so that stream has to swallow the keystrokes: overwriting them after
 * the fact is racy and leaks the input into the terminal scrollback.
 */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const muffled = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: muffled, terminal: true });
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf("--email");
  const newEmail = emailIdx >= 0 ? args[emailIdx + 1] : undefined;
  const positional = args.filter((_, i) => i !== emailIdx && i !== emailIdx + 1);
  const [email, argPassword] = positional;

  if (!email) throw new Error("Usage: npm run user:password -- <email> [--email <new-login-email>]");

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (checked the environment and .env).");
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new Error(`No app user with email ${email}`);
  if (!user.authUserId) {
    throw new Error(
      `${user.email} has no Supabase sign-in record.\n` +
        `Create one first:  npx tsx scripts/link-supabase-auth.ts ${user.email} <password>`,
    );
  }

  const password = argPassword || (await askHidden("New password: "));
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.updateUserById(user.authUserId, {
    password,
    ...(newEmail ? { email: newEmail.toLowerCase().trim(), email_confirm: true } : {}),
  });
  if (error) throw new Error(error.message);

  const updated = newEmail
    ? await db.user.update({ where: { id: user.id }, data: { email: newEmail.toLowerCase().trim(), active: true } })
    : await db.user.update({ where: { id: user.id }, data: { active: true } });

  console.log(`Password updated for ${updated.name} <${updated.email}> (${updated.role}). The account is active.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
