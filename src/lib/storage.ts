import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Storage, used for job photos and expense receipts.
 *
 * A deployed instance has no writable disk, so uploads cannot live under
 * public/uploads the way they did in v1 -- anything written there disappears
 * on the next deploy.
 *
 * This runs server-side only. The service role key must never reach the
 * browser: the upload route is what calls it, after checking the session.
 */
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const BUCKET = process.env.SUPABASE_BUCKET || "uploads";

/** Null when storage is not configured, so callers can fail with a clear message. */
export const storage =
  url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false } }).storage
    : null;

export const storageConfigured = () => storage !== null;

/**
 * True for a URL this app actually produced -- a public object in our bucket.
 *
 * Photos are written by `jobs.addPhoto`, which takes a URL string, so without
 * this check anything at all can be attached: a link to a site that blocks
 * hotlinking, a plain http:// address the browser refuses to load on an https
 * page, or a typo. All three show up as a broken thumbnail that looks like a
 * corrupt upload, and none of them can be repaired after the fact.
 */
export function isUploadedFileUrl(candidate: string): boolean {
  let u: URL;
  try { u = new URL(candidate); } catch { return false; }
  if (u.protocol !== "https:") return false;
  // With storage unconfigured (local dev against a bare database) there is no
  // bucket to compare against, so accept any https URL rather than block work.
  if (!url) return true;
  try {
    const base = new URL(url);
    return u.host === base.host && u.pathname.startsWith(`/storage/v1/object/public/${BUCKET}/`);
  } catch { return true; }
}
