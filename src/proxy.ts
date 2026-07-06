import { NextResponse, type NextRequest } from "next/server";

// UX convenience only, never the security boundary (engineering rules): the
// Suspense-streamed session checks inside /sign-in and /account remain
// authoritative. This just restores pre-render redirect semantics that
// cacheComponents' static shells removed — a signed-in user shouldn't see
// the sign-in card flash (and vice versa) while the streamed check runs.
// Cookie PRESENCE is checked, not validity — a stale cookie just means the
// in-page check does the real work.
const SESSION_COOKIES = [
  "better-auth.session_token",
  // Secure-context prefix (production HTTPS).
  "__Secure-better-auth.session_token",
];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.has(name));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/sign-in" && hasSessionCookie(request)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname === "/account" && !hasSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/sign-in", "/account"],
};
