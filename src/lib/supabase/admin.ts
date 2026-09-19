import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, for managing accounts on the user's behalf:
 * creating them, resetting passwords, removing them.
 *
 * Server-side only. The service role key bypasses row-level security, so it
 * must never be sent to the browser.
 */
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client =
  url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

export const authAdminConfigured = () => client !== null;

function admin() {
  if (!client) throw new Error("Account management is not configured on this server.");
  return client.auth.admin;
}

/** Creates the Supabase account. Returns its id, for User.authUserId. */
export async function createAuthUser(email: string, password: string): Promise<string> {
  // email_confirm: no mail server is configured, so confirming here avoids
  // creating accounts nobody can sign in to.
  const { data, error } = await admin().createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  return data.user.id;
}

export async function setAuthPassword(authUserId: string, password: string) {
  const { error } = await admin().updateUserById(authUserId, { password });
  if (error) throw new Error(error.message);
}

export async function setAuthEmail(authUserId: string, email: string) {
  const { error } = await admin().updateUserById(authUserId, { email, email_confirm: true });
  if (error) throw new Error(error.message);
}

/**
 * Removes the Supabase account. Used to undo a half-finished creation, so it
 * reports failure rather than throwing -- the caller is already handling one
 * error and should surface that one.
 */
export async function deleteAuthUser(authUserId: string): Promise<boolean> {
  const { error } = await admin().deleteUser(authUserId);
  return !error;
}
