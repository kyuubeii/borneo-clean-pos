import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Refreshes the Supabase session and writes the rotated cookies onto the
 * response.
 *
 * This exists because Server Components cannot set cookies: without a request
 * that can, the access token would expire and never be replaced, signing
 * everyone out once it lapsed. It deliberately does no authorisation -- role
 * checks stay in the action registry, where they can see what is being asked.
 */
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!URL || !KEY) return response;

  const supabase = createServerClient(URL, KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Touching the user is what triggers the refresh; the result is unused here.
  await supabase.auth.getUser();
  return response;
}
