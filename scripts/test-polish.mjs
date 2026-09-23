import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// Generate a separate SQLite client; never push the application's Postgres schema.
const scratch = mkdtempSync(join(tmpdir(), "borneo-polish-test-"));
const localTemp = resolve("scripts/.tmp");
mkdirSync(localTemp, { recursive: true });
const schemaPath = join(localTemp, `polish-${process.pid}.prisma`);
const clientPath = join(scratch, "client");
const databasePath = join(scratch, "test.db");
const schema = readFileSync("prisma/schema.prisma", "utf8")
  .replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientPath)}`)
  .replace('provider  = "postgresql"', 'provider  = "sqlite"')
  .replace('url       = env("DATABASE_URL")', `url = ${JSON.stringify(`file:${databasePath}`)}`)
  .replace('  directUrl = env("DIRECT_URL")', '');
if (schema.includes('provider  = "postgresql"') || schema.includes('env("DATABASE_URL")')) throw new Error("Test schema must be isolated");
writeFileSync(schemaPath, schema);
writeFileSync(databasePath, "");
const run = (bin, args, extra = {}) => {
  const result = spawnSync(resolve("node_modules/.bin", bin), args, { stdio: "inherit", env: { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", ...extra } });
  if (result.status !== 0) throw new Error(`${bin} exited with ${result.status}: ${result.error ?? "see output"}`);
};
try {
  run("prisma", ["generate", "--schema", schemaPath]);
  run("prisma", ["db", "push", "--schema", schemaPath, "--skip-generate"]);
  run("tsx", ["scripts/polish.test.ts"], { POLISH_TEST_CLIENT: clientPath });
  run("tsx", ["scripts/push.test.ts"], { POLISH_TEST_CLIENT: clientPath });
} finally {
  rmSync(schemaPath, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
