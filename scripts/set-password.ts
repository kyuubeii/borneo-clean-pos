/**
 * Command-line password reset — the way back in when nobody can sign in.
 *
 * The app has no self-service reset: users.resetPassword needs an owner who is
 * already signed in, so a single locked-out owner would have no route back.
 *
 *   npm run user:password -- <email> <new-password>
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();
// Must match hashPassword() in src/lib/auth.ts, fallback included.
const SECRET = process.env.SESSION_SECRET || "borneo-clean-dev-secret";
const hash = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("Usage: npm run user:password -- <email> <new-password>");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new Error(`No user with email ${email}`);

  await db.user.update({ where: { id: user.id }, data: { password: hash(password), active: true } });
  console.log(`Password updated for ${user.name} <${user.email}> (${user.role}). The account is active.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
