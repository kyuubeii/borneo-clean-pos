import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client, used for sign-out and password changes. */
export const supabaseBrowser = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
