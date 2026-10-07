/**
 * Every action the app has reaches the assistant as a tool the model can call.
 * One malformed tool makes the provider reject the whole request, so each is
 * checked against the rules OpenRouter's models enforce. Run through `npm run test:polish`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function main() {
  const path = process.env.POLISH_TEST_CLIENT;
  if (!path || !path.includes("borneo-polish-test")) throw new Error("Use npm run test:polish; an isolated client is required.");
  const { PrismaClient } = require(path);
  (globalThis as any).prisma = new PrismaClient();
  const { allActions, toolSchemas, resolveAction } = await import("../src/lib/registry");
  await import("../src/lib/actions");

  let passed = 0;
  async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }

  const roles = ["OWNER", "ADMIN", "STAFF"] as const;
  const tools = Object.fromEntries(roles.map((role) => [role, toolSchemas({ id: "t", name: "T", role } as any)]));

  await check("every action is a tool for at least one role", () => {
    const offered = new Set(roles.flatMap((r) => tools[r].map((t: any) => t.function.name)));
    const missing = allActions().filter((a) => !offered.has(a.name.replace(/\./g, "_"))).map((a) => a.name);
    assert.deepEqual(missing, []);
  });

  await check("each role gets exactly the actions it may run", () => {
    for (const r of roles) {
      const want = allActions().filter((a) => a.roles.includes(r as any)).length;
      assert.equal(tools[r].length, want, r);
    }
  });

  await check("tool names, descriptions and parameters meet the providers' rules", () => {
    for (const t of tools.OWNER.concat(tools.STAFF)) {
      const f = t.function, where = f.name;
      assert.match(f.name, /^[a-zA-Z0-9_-]{1,64}$/, where);
      assert.ok(f.description.trim().length >= 20, `${where}: description too thin for the model`);
      assert.ok(f.description.length <= 1024, `${where}: description over 1024 characters`);
      assert.equal(f.parameters.type, "object", where);
      const json = JSON.stringify(f.parameters);
      assert.ok(!json.includes("$ref") && !json.includes("$schema"), `${where}: schema uses $ref`);
      for (const req of f.parameters.required) assert.ok(req in f.parameters.properties, `${where}: requires missing "${req}"`);
      for (const [k, v] of Object.entries<any>(f.parameters.properties)) {
        assert.ok(v.type || v.anyOf || v.oneOf || v.allOf || v.enum, `${where}.${k}: has no type, so the model cannot tell what to send`);
      }
    }
  });

  await check("every tool name the model sees resolves back to its action", () => {
    for (const a of allActions()) assert.equal(resolveAction(a.name.replace(/\./g, "_"))?.name, a.name);
  });

  await check("deleting, voiding and money movements wait for the person to confirm", () => {
    const risky = /\.(delete\w*|refund|record|merge|createPayout|markPaid|markReimbursed|updateStatus|resetPassword|cancel)$/;
    const ungated = allActions().filter((a) => !a.readOnly && risky.test(a.name) && !a.requiresConfirm
      // A cleaner moving their own job along, and a quote's own status, are routine.
      && !["jobs.updateStatus", "quotes.updateStatus", "bookings.updateStatus", "expenses.record"].includes(a.name)).map((a) => a.name);
    assert.deepEqual(ungated, []);
  });

  await check("combining invoices is offered to the office, not to cleaners", () => {
    assert.ok(tools.OWNER.some((t: any) => t.function.name === "invoices_merge"));
    assert.ok(tools.ADMIN.some((t: any) => t.function.name === "invoices_merge"));
    assert.ok(!tools.STAFF.some((t: any) => t.function.name === "invoices_merge"));
  });

  console.log(`\n${passed} assistant tool checks passed (${allActions().length} actions).`);
  await (globalThis as any).prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
