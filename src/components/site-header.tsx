import Link from "next/link";
import { Suspense } from "react";

import { HeaderAuth, HeaderAuthFallback } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";

// Static shell — no request data. Session state renders inside the
// HeaderAuth client island so public pages remain ISR-cacheable (also why
// nav links carry no active-route styling: that would need a client island).
// Category discovery and search live on the home page itself (owner-approved
// fold of /search and /categories/[slug] into home, epic 03 SRCH); the
// header no longer needs its own search entry point — the brand link
// already goes to the same page.
export function SiteHeader() {
  return (
    <HeaderShell maxWidthClass="max-w-4xl">
      <div className="flex min-w-0 items-center gap-5">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Paulitakes
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          {/* Brand already links home; the explicit link appears once
                space allows (mobile-first, FR-9.4). */}
          <Link
            href="/"
            className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Home
          </Link>
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        {/* HeaderAuth reads usePathname; wrap so it's deferred out of the
            prerendered shell on dynamic routes (cacheComponents). */}
        <Suspense fallback={<HeaderAuthFallback />}>
          <HeaderAuth />
        </Suspense>
      </div>
    </HeaderShell>
  );
}
