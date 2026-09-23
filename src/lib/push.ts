import crypto from "crypto";
import http2 from "http2";
import { after } from "next/server";
import { db } from "./db";
import { unreadCount } from "./notify";

/**
 * Push notifications to the iPhone app through APNs.
 *
 * Push is an extra copy of a notification the bell already shows, never a
 * replacement: notify() writes the row exactly as before, and this only sends
 * it on to the phones whose owner can see it and has that type switched on.
 *
 * Everything here is a no-op until the APNs key is configured, so deploying it
 * changes nothing on its own.
 */

/** Every type notify() is called with, plus OTHER for anything else. */
export const PUSH_TYPES = ["BOOKING_CONFIRMED", "SCHEDULE_CHANGE", "STAFF", "JOB_COMPLETED", "INVOICE", "REMINDER", "OTHER"] as const;

/**
 * What a new phone pushes before anyone changes it. Cleaners start with what
 * concerns their own work; the office starts with everything.
 */
export function defaultTypes(role: string): string[] {
  return role === "STAFF" ? ["STAFF", "SCHEDULE_CHANGE", "REMINDER", "OTHER"] : [...PUSH_TYPES];
}

export const typeBucket = (type: string) => ((PUSH_TYPES as readonly string[]).includes(type) ? type : "OTHER");

const env = () => ({
  keyId: process.env.APNS_KEY_ID ?? "",
  teamId: process.env.APNS_TEAM_ID ?? "",
  // Vercel keeps a multi-line value as typed, but a key pasted onto one line
  // arrives with literal "\n"s; accept both.
  key: (process.env.APNS_KEY ?? "").replace(/\\n/g, "\n"),
  topic: process.env.APNS_BUNDLE_ID || "com.borneoclean.app",
});

export const apnsConfigured = () => {
  const e = env();
  return Boolean(e.keyId && e.teamId && e.key.includes("PRIVATE KEY"));
};

type Environment = "production" | "sandbox";
/** Apple's two hosts. The overrides exist only so the tests can stand in a local server. */
const host = (e: Environment) => e === "sandbox"
  ? process.env.APNS_HOST_SANDBOX || "https://api.sandbox.push.apple.com"
  : process.env.APNS_HOST_PRODUCTION || "https://api.push.apple.com";

let cachedJwt: { token: string; at: number } | null = null;

/** APNs provider token: ES256, reusable for up to an hour, refreshed at 50 minutes. */
function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.at < 50 * 60) return cachedJwt.token;
  const { keyId, teamId, key } = env();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: keyId })}.${b64({ iss: teamId, iat: now })}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedJwt = { token: `${unsigned}.${sig}`, at: now };
  return cachedJwt.token;
}

type Sent = { status: number; reason?: string };

/** One HTTP/2 session per host per dispatch, closed when the batch is done. */
function sessionFor(host: string) {
  const s = http2.connect(host);
  s.on("error", () => {}); // surfaced per request instead
  return s;
}

function sendOne(session: http2.ClientHttp2Session, token: string, body: string): Promise<Sent> {
  return new Promise((resolve) => {
    const { topic } = env();
    const req = session.request({
      ":method": "POST", ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0, data = "";
    const timer = setTimeout(() => { req.close(); resolve({ status: 0, reason: "timeout" }); }, 10_000);
    req.on("response", (h) => { status = Number(h[":status"]) || 0; });
    req.setEncoding("utf8");
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      clearTimeout(timer);
      let reason: string | undefined;
      try { reason = data ? JSON.parse(data).reason : undefined; } catch {}
      resolve({ status, reason });
    });
    req.on("error", () => { clearTimeout(timer); resolve({ status: 0, reason: "network" }); });
    req.end(body);
  });
}

/**
 * Send one notification to every phone that should get it.
 *
 * Keyed on the notification id and re-read from the database, so a row
 * written inside a transaction that was then rolled back (a scheduling
 * conflict retried by scheduleWrite) is simply not found and sends nothing.
 */
export async function dispatchPush(notificationId: string) {
  if (!apnsConfigured()) return;
  const n = await db.notification.findUnique({ where: { id: notificationId } });
  if (!n) return;
  const bucket = typeBucket(n.type);

  // The same people who see it in the bell: everyone for a broadcast, or the
  // one person it names -- and only accounts that can still sign in.
  const devices = await db.pushDevice.findMany({
    where: { user: { active: true, ...(n.userId ? { id: n.userId } : {}) } },
  });
  const wanted = devices.filter((d) => d.types.split(",").includes(bucket));
  if (!wanted.length) return;

  const badges = new Map<string, number>();
  for (const userId of new Set(wanted.map((d) => d.userId))) badges.set(userId, await unreadCount(userId));

  const sessions = new Map<string, http2.ClientHttp2Session>();
  const session = (e: Environment) => {
    if (!sessions.has(e)) sessions.set(e, sessionFor(host(e)));
    return sessions.get(e)!;
  };

  try {
    await Promise.all(wanted.map(async (d) => {
      const body = JSON.stringify({
        aps: { alert: { title: n.title, ...(n.body ? { body: n.body } : {}) }, sound: "default", badge: badges.get(d.userId) ?? 0 },
        link: n.link ?? null, notificationId: n.id, type: n.type,
      });
      const home: Environment = d.environment === "sandbox" ? "sandbox" : "production";
      let r = await sendOne(session(home), d.token, body);
      // A development build's token is refused by the production host and the
      // other way round. Try the other one once before giving up on the token.
      if (r.status === 400 && r.reason === "BadDeviceToken") {
        const other: Environment = home === "sandbox" ? "production" : "sandbox";
        const retry = await sendOne(session(other), d.token, body);
        if (retry.status === 200) {
          await db.pushDevice.update({ where: { id: d.id }, data: { environment: other } }).catch(() => {});
          return;
        }
        r = retry;
      }
      if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered" || r.reason === "DeviceTokenNotForTopic") {
        await db.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
      } else if (r.status !== 200) {
        console.error("push not delivered", { status: r.status, reason: r.reason });
      }
    }));
  } finally {
    for (const s of sessions.values()) s.close();
  }
}

/**
 * Send after the response, once the write that raised the notification has
 * committed. Outside a request (a script) there is no response to wait for,
 * so it simply runs.
 */
export function schedulePush(notificationId: string) {
  if (!apnsConfigured()) return;
  const run = () => dispatchPush(notificationId).catch((e) => console.error("push failed", e));
  try { after(run); } catch { void run(); }
}
