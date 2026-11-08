import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/** Optimistic gate only — every page and action re-validates the session server-side. */
export function middleware(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!api|sign-in|sign-up|_next|icon|apple-touch-icon|manifest|favicon|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
