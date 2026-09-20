import type { NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/middleware";

/**
 * Session refresh only. Authorisation is not done here on purpose -- middleware
 * is the wrong place to make access decisions, and the app already gates by
 * role inside the action registry.
 */
export async function middleware(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  matcher: [
    // Page and RSC navigations only.
    //
    // /api is deliberately excluded. Every API call was paying for a Supabase
    // Auth round trip here and a second one in the handler, and the dashboard
    // makes several per page. Route Handlers -- unlike Server Components -- can
    // write cookies, so supabaseServer() rotates the token itself on those
    // requests; nothing is lost by not doing it twice.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
