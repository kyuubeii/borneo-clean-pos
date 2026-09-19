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
 * hashPassword() in src/lib/auth.ts salts with SESSION_SECRET, so a hash is
 * only valid where that same secret is set. This script reads .env and refuses
 * to run when SESSION_SECRET is missing. Falling back to the default is worse
 * than an error: it writes a hash that works locally and fails in production,
 * and nothing looks wrong until someone tries to sign in.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { readFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { Writable } from "stream";

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

const SECRET = process.env.SESSION_SECRET;
const db = new PrismaClient();
// Must match hashPassword() in src/lib/auth.ts.
const hash = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

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
  if (!SECRET) {
    throw new Error(
      "SESSION_SECRET is not set (checked the environment and .env).\n" +
        "Set it to the value the deployed app uses, or the new password will not work there.",
    );
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new Error(`No user with email ${email}`);

  const password = argPassword || (await askHidden("New password: "));
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const data: { password: string; active: boolean; email?: string } = {
    password: hash(password),
    active: true,
  };
  if (newEmail) data.email = newEmail.toLowerCase().trim();

  const updated = await db.user.update({ where: { id: user.id }, data });
  console.log(`Password updated for ${updated.name} <${updated.email}> (${updated.role}). The account is active.`);
  console.log(`Hashed with the SESSION_SECRET ending ...${SECRET.slice(-4)}; the deployment must use the same one.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
