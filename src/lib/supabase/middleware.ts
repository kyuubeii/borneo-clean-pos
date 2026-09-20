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

  // getSession(), not getUser().
  //
  // getUser() validates the JWT against Supabase's servers on every call, so it
  // put a network round trip in front of every page navigation -- which is what
  // made clicking around the sidebar feel slow. getSession() reads the session
  // out of the cookie and only goes to the network when the access token is
  // within 90 seconds of expiring, which is precisely when a refresh is due.
  //
  // The usual objection to getSession() is that its session is unverified. That
  // does not apply here: this middleware makes no authorisation decision. It
  // rotates the token and nothing else. Every access decision is made in the
  // action registry, behind getUser(), which does verify.
  await supabase.auth.getSession();
  return response;
}
