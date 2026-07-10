"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { authClient } from "@/lib/auth/client";

// Static, request-data-free placeholder matching the avatar footprint. Used
// both while the session is pending and as the Suspense fallback — the latter
// is what the prerendered shell of a dynamic route renders, so it must not
// read usePathname/useSession.
export function HeaderAuthFallback() {
  return <div aria-hidden className="size-8 rounded-full bg-muted" />;
}

// Session-aware corner of the site header. Kept client-side so the header —
// and every ISR page under the public layout — stays statically cacheable
// (design §2: user-specific data lives in small client islands). Reads
// usePathname, so callers wrap it in <Suspense> (fallback: HeaderAuthFallback)
// so it can be deferred out of the prerendered shell on dynamic routes.
export function HeaderAuth() {
  const { data: session, isPending } = authClient.useSession();
  const pathname = usePathname();

  if (isPending) {
    return <HeaderAuthFallback />;
  }

  if (session) {
    // Staff get an "Admin dashboard" shortcut into /admin from the main app
    // (feedback: admin should be reachable from the normal nav). This is UX
    // only — requireStaff() on every /admin page is the real boundary — so a
    // client-side role/ban check here is fine; authz.isStaff is server-only.
    const { role, bannedAt } = session.user;
    const isStaff = (role === "author" || role === "admin") && !bannedAt;
    return (
      <UserMenu
        name={session.user.name}
        image={session.user.image ?? null}
        isStaff={isStaff}
      />
    );
  }

  // ?next= returns the user here after OAuth, and lets a stale-cookie
  // holder through the proxy's signed-in /sign-in → / redirect so they can
  // actually re-authenticate. Omitted on /sign-in itself (self-redirect).
  const next =
    pathname === "/sign-in" ? "" : `?next=${encodeURIComponent(pathname)}`;

  return (
    <Link
      href={`/sign-in${next}`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Sign in
    </Link>
  );
}
