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
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
