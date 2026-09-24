/**
 * Push dispatch against a disposable SQLite copy of the schema and a local
 * stand-in for APNs. Never imports the live client and never reaches Apple.
 * Run through `npm run test:polish`.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

type Hit = { host: string; token: string; headers: http2.IncomingHttpHeaders; body: any };

function fakeApns(name: string, hits: Hit[], reply: (token: string) => { status: number; reason?: string }) {
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => { data += c; });
    stream.on("end", () => {
      const token = String(headers[":path"]).split("/").pop()!;
      hits.push({ host: name, token, headers, body: JSON.parse(data) });
      const r = reply(token);
      stream.respond({ ":status": r.status });
      stream.end(r.reason ? JSON.stringify({ reason: r.reason }) : "");
    });
  });
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    }));
}

async function main() {
  const path = process.env.POLISH_TEST_CLIENT;
  if (!path || !path.includes("borneo-polish-test")) throw new Error("Use npm run test:polish; an isolated client is required.");
  const { PrismaClient } = require(path);
  const client = new PrismaClient();
  (globalThis as any).prisma = client;

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.APNS_KEY_ID = "TESTKEY123";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
  process.env.APNS_BUNDLE_ID = "com.borneoclean.app";

  const hits: Hit[] = [];
  const BAD_ON_PROD = "b".repeat(64), GONE = "c".repeat(64);
  const prod = await fakeApns("production", hits, (tk) =>
    tk === BAD_ON_PROD ? { status: 400, reason: "BadDeviceToken" } : tk === GONE ? { status: 410, reason: "Unregistered" } : { status: 200 });
  const sandbox = await fakeApns("sandbox", hits, (tk) => tk === GONE ? { status: 410, reason: "Unregistered" } : { status: 200 });
  process.env.APNS_HOST_PRODUCTION = prod.url;
  process.env.APNS_HOST_SANDBOX = sandbox.url;

  const { dispatchPush, defaultTypes, apnsConfigured, typeBucket } = await import("../src/lib/push");
  const { notify } = await import("../src/lib/notify");

  let passed = 0;
  async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }
  const tokensFor = (id: string) => hits.filter((h) => h.body.notificationId === id).map((h) => h.token).sort();
  // The bell's unread count, worked out here rather than through the code under test.
  const since = new Date(Date.now() - 30 * 86400000);
  const visible = (userId: string) => client.notification.count({ where: { OR: [{ userId: null }, { userId }], createdAt: { gte: since } } });
  const unread = (userId: string) => client.notification.count({ where: {
    OR: [{ userId: null }, { userId }], createdAt: { gte: since },
    NOT: { receipts: { some: { userId, OR: [{ read: true }, { dismissed: true }] } } } } });

  try {
    const owner = await client.user.create({ data: { email: "push-owner@test", name: "Owner", password: "", role: "OWNER" } });
    const cleaner = await client.user.create({ data: { email: "push-cleaner@test", name: "Cleaner", password: "", role: "STAFF" } });
    const gone = await client.user.create({ data: { email: "push-inactive@test", name: "Left", password: "", role: "ADMIN", active: false } });
    const OWNER_TK = "a".repeat(64), CLEANER_TK = "d".repeat(64), INACTIVE_TK = "e".repeat(64);
    await client.pushDevice.createMany({ data: [
      { token: OWNER_TK, userId: owner.id, types: defaultTypes("OWNER").join(",") },
      { token: CLEANER_TK, userId: cleaner.id, types: defaultTypes("STAFF").join(","), environment: "sandbox" },
      { token: INACTIVE_TK, userId: gone.id, types: defaultTypes("ADMIN").join(",") },
    ] });

    await check("configured from the environment, key pasted on one line", () => assert.equal(apnsConfigured(), true));

    await check("an office type reaches the office and not a cleaner, nor a deactivated account", async () => {
      const n = await client.notification.create({ data: { type: "INVOICE", title: "Invoice INV-9001 raised", link: "/invoices/x" } });
      await dispatchPush(n.id);
      assert.deepEqual(tokensFor(n.id), [OWNER_TK]);
    });

    await check("a cleaner type reaches both, over each phone's own APNs host", async () => {
      const n = await client.notification.create({ data: { type: "STAFF", title: "Assigned to job JOB-9001" } });
      await dispatchPush(n.id);
      assert.deepEqual(tokensFor(n.id), [OWNER_TK, CLEANER_TK].sort());
      assert.equal(hits.find((h) => h.body.notificationId === n.id && h.token === CLEANER_TK)!.host, "sandbox");
      assert.equal(hits.find((h) => h.body.notificationId === n.id && h.token === OWNER_TK)!.host, "production");
    });

    await check("a notification for one person goes only to that person", async () => {
      const n = await client.notification.create({ data: { userId: cleaner.id, type: "SCHEDULE_CHANGE", title: "Moved" } });
      await dispatchPush(n.id);
      assert.deepEqual(tokensFor(n.id), [CLEANER_TK]);
    });

    await check("the request is what APNs expects: signed token, topic, alert, link and badge", async () => {
      const h = hits.find((x) => x.token === OWNER_TK && x.body.aps.alert.title === "Invoice INV-9001 raised")!;
      assert.equal(h.headers["apns-topic"], "com.borneoclean.app");
      assert.equal(h.headers["apns-push-type"], "alert");
      const [head, payload, sig] = String(h.headers.authorization).replace("bearer ", "").split(".");
      assert.equal(JSON.parse(Buffer.from(head, "base64url").toString()).kid, "TESTKEY123");
      assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).iss, "TEAM123456");
      assert.ok(crypto.verify("sha256", Buffer.from(`${head}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
      assert.equal(h.body.link, "/invoices/x");
      assert.equal(typeof h.body.aps.badge, "number");
    });

    await check("the badge follows what the person has read in the bell", async () => {
      const first = await client.notification.findFirst({ where: { type: "INVOICE" } });
      await client.notificationReceipt.create({ data: { userId: owner.id, notificationId: first.id, read: true } });
      const n = await client.notification.create({ data: { type: "JOB_COMPLETED", title: "Job JOB-9001 completed" } });
      await dispatchPush(n.id);
      const badge = hits.find((h) => h.body.notificationId === n.id)!.body.aps.badge;
      assert.equal(badge, await unread(owner.id));
      // One less than everything the owner can see: the invoice notice they read.
      assert.equal(badge, (await visible(owner.id)) - 1);
    });

    await check("switching a type off stops it for that phone only", async () => {
      await client.pushDevice.update({ where: { token: OWNER_TK }, data: { types: "STAFF" } });
      const n = await client.notification.create({ data: { type: "JOB_COMPLETED", title: "Another" } });
      await dispatchPush(n.id);
      assert.deepEqual(tokensFor(n.id), []);
      await client.pushDevice.update({ where: { token: OWNER_TK }, data: { types: defaultTypes("OWNER").join(",") } });
    });

    await check("a type nobody listed goes out as Other", async () => {
      assert.equal(typeBucket("SOMETHING_NEW"), "OTHER");
      const n = await client.notification.create({ data: { type: "SOMETHING_NEW", title: "Custom" } });
      await dispatchPush(n.id);
      assert.deepEqual(tokensFor(n.id), [OWNER_TK, CLEANER_TK].sort());
    });

    await check("a notification that was rolled back sends nothing", async () => {
      const before = hits.length;
      await dispatchPush("does-not-exist");
      assert.equal(hits.length, before);
    });

    await check("a development token sent to production is retried on sandbox and remembered", async () => {
      await client.pushDevice.create({ data: { token: BAD_ON_PROD, userId: owner.id, types: "REMINDER" } });
      const n = await client.notification.create({ data: { type: "REMINDER", title: "Bring ladders" } });
      await dispatchPush(n.id);
      const mine = hits.filter((h) => h.token === BAD_ON_PROD).map((h) => h.host);
      assert.deepEqual(mine, ["production", "sandbox"]);
      assert.equal((await client.pushDevice.findUnique({ where: { token: BAD_ON_PROD } })).environment, "sandbox");
    });

    await check("a phone that uninstalled the app is forgotten", async () => {
      await client.pushDevice.create({ data: { token: GONE, userId: owner.id, types: "REMINDER" } });
      const n = await client.notification.create({ data: { type: "REMINDER", title: "Again" } });
      await dispatchPush(n.id);
      assert.equal(await client.pushDevice.count({ where: { token: GONE } }), 0);
      assert.equal(await client.pushDevice.count({ where: { token: OWNER_TK } }), 1);
    });

    await check("notify() still writes the bell row and sends it on", async () => {
      const before = await client.notification.count();
      await notify({ type: "BOOKING_CONFIRMED", title: "Booking BKG-9001 confirmed", link: "/bookings/y" });
      assert.equal(await client.notification.count(), before + 1);
      // Outside a request there is no response to wait for, so it sends straight away.
      for (let i = 0; i < 50 && !hits.some((h) => h.body.aps.alert.title === "Booking BKG-9001 confirmed"); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(hits.some((h) => h.token === OWNER_TK && h.body.aps.alert.title === "Booking BKG-9001 confirmed"));
      assert.ok(!hits.some((h) => h.token === CLEANER_TK && h.body.aps.alert.title === "Booking BKG-9001 confirmed"));
    });

    await check("a test push reaches only the caller's phones and reports Apple's answer", async () => {
      const { testPush } = await import("../src/lib/push");
      const before = await client.notification.count();
      const r = await testPush(cleaner.id);
      assert.equal(r.configured, true);
      assert.equal(r.config.keyId && r.config.teamId && r.config.key && r.config.keyLoads, true);
      assert.equal(r.config.keyIdLength, 10);
      assert.equal(r.config.topic, "com.borneoclean.app");
      assert.deepEqual(r.results, [{ environment: "sandbox", status: 200, reason: undefined }]);
      assert.equal(hits.at(-1)!.token, CLEANER_TK);
      assert.equal(await client.notification.count(), before);
    });

    await check("the key works however it was pasted", async () => {
      const { normaliseKey } = await import("../src/lib/push");
      const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
      const loads = (k: string) => crypto.createPrivateKey(normaliseKey(k)).asymmetricKeyType === "ec";
      for (const [how, k] of [
        ["as the file", pem], ["one line with \\n", pem.replace(/\n/g, "\\n")], ["breaks as spaces", pem.replace(/\n/g, " ")],
        ["body only", body], ["body in quotes", `"${body}"`], ["body over lines", body.match(/.{1,64}/g)!.join("\n")],
      ] as const) assert.ok(loads(k), how);
      assert.equal(normaliseKey("not a key"), "not a key");
    });

    await check("notification text gives times on the Kuching clock, whatever the server's zone", async () => {
      const { fmtStamp } = await import("../src/lib/dates");
      assert.match(fmtStamp(new Date("2026-09-24T02:00:00Z")), /10:00:00\s?am/i);
    });

    console.log(`${passed} push checks passed`);
  } finally {
    prod.close(); sandbox.close();
    await client.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
