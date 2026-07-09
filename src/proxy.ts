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

  // A ?next= arrival may hold a stale cookie (bounced out of /admin by the
  // real gate) — let it through so the in-page session check decides,
  // otherwise a revoked-session user could never reach the sign-in card.
  // Accepted tradeoff: a genuinely signed-in ?next= arrival sees the card
  // until the streamed redirect fires; cookie presence can't distinguish the
  // two, and bouncing to the next target would loop stale cookies forever.
  if (
    pathname === "/sign-in" &&
    hasSessionCookie(request) &&
    !request.nextUrl.searchParams.has("next")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname === "/account" && !hasSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  // The authoritative role gate for /admin is requireStaff() (layout + every
  // admin page). ?next= sends staff back to the page they asked for.
  if (pathname.startsWith("/admin") && !hasSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/sign-in", "/account", "/admin/:path*"],
};
