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
