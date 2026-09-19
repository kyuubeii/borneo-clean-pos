/**
 * Writes the Supabase connection strings into .env without them passing
 * through a chat window or your shell history.
 *
 *   node scripts/set-db-url.mjs
 *
 * Paste the pooled URI from the Supabase dashboard (Connect -> ORMs -> Prisma,
 * the one on port 6543) with the real password already substituted in. The
 * input is hidden. DIRECT_URL is derived from it by switching to port 5432,
 * which is the same host in session mode.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (["\n", "\r", ""].includes(char.toString())) process.stdin.removeListener("data", onData);
      else process.stdout.write("[2K[200D" + prompt + "*".repeat(rl.line.length));
    };
    process.stdin.on("data", onData);
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const pooled = await askHidden("Pooled Supabase URI (port 6543): ");

if (!/^postgres(ql)?:\/\/\S+@\S+:\d+\/\w+/.test(pooled)) {
  console.error("\nThat does not look like a Postgres URI. Expected something like:");
  console.error("  postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:6543/postgres");
  process.exit(1);
}
if (pooled.includes("[YOUR-PASSWORD]") || pooled.includes("<password>")) {
  console.error("\nThe password placeholder is still in the string. Substitute the real password first.");
  process.exit(1);
}

const url = new URL(pooled);
if (url.port !== "6543") {
  console.warn(`\nWarning: expected port 6543 for the pooled connection, got ${url.port}.`);
}

// Same host, session mode. Prisma uses this one for migrations, which need
// features the transaction pooler does not offer.
const direct = new URL(pooled);
direct.port = "5432";
direct.search = "";

const pooledFinal = new URL(pooled);
if (!pooledFinal.searchParams.has("pgbouncer")) pooledFinal.searchParams.set("pgbouncer", "true");

const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const without = env
  .split("\n")
  .filter((l) => !/^(DATABASE_URL|DIRECT_URL)=/.test(l))
  .join("\n")
  .replace(/\n+$/, "");

writeFileSync(
  ".env",
  `${without}\nDATABASE_URL="${pooledFinal.toString()}"\nDIRECT_URL="${direct.toString()}"\n`,
);

console.log(`Wrote DATABASE_URL (port 6543) and DIRECT_URL (port 5432) to .env for host ${url.hostname}.`);
