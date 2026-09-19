import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when Supabase Auth is configured; lets callers fail with a clear message. */
export const authConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Supabase client bound to the request's cookies.
 *
 * Server Components cannot set cookies. When Supabase refreshes a token there,
 * the write throws and is swallowed: the refreshed session is still used for
 * that request, and middleware writes it back on a subsequent one. Without the
 * middleware in src/middleware.ts, sessions would simply expire and never
 * refresh, logging everyone out after the access token's lifetime.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component render — middleware refreshes the cookie instead.
        }
      },
    },
  });
}
