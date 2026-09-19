/**
 * Command-line password reset — the way back in when nobody can sign in.
 *
 * The app has no self-service reset: users.resetPassword needs an owner who is
 * already signed in, so a single locked-out owner would have no route back.
 *
 *   npm run user:password -- <email>
 *
 * Prompts for the password without echoing it. Passing it as a second
 * argument still works, but puts it in the shell history.
 *
 * It hashes with SESSION_SECRET from .env, so that value must match the one
 * set in the deployed environment or the new password will not work there.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { createInterface } from "readline";

const db = new PrismaClient();
// Must match hashPassword() in src/lib/auth.ts, fallback included.
const SECRET = process.env.SESSION_SECRET || "borneo-clean-dev-secret";
const hash = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

/** Reads a password without echoing it, so it stays out of the shell history. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (chunk: Buffer) => {
      if (["\n", "\r", ""].includes(chunk.toString())) process.stdin.removeListener("data", onData);
      else process.stdout.write("[2K[200D" + prompt + "*".repeat((rl as any).line.length));
    };
    process.stdin.on("data", onData);
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  const [email, argPassword] = process.argv.slice(2);
  if (!email) throw new Error("Usage: npm run user:password -- <email> [new-password]");

  // Passing the password as an argument still works, but omitting it prompts
  // instead, which keeps it out of the shell history.
  const password = argPassword || (await askHidden("New password: "));
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new Error(`No user with email ${email}`);

  await db.user.update({ where: { id: user.id }, data: { password: hash(password), active: true } });
  console.log(`Password updated for ${user.name} <${user.email}> (${user.role}). The account is active.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
