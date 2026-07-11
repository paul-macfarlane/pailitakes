import { Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeaderAuth, HeaderAuthFallback } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

// Static shell — no request data. Session state renders inside the
// HeaderAuth client island so public pages remain ISR-cacheable (also why
// nav links carry no active-route styling: that would need a client island).
// Category discovery and search moved onto the home page itself (owner
// feedback, epic 03 SRCH); the header keeps only a compact icon link to
// /search.
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
        <Button
          render={<Link href="/search" aria-label="Search" />}
          variant="ghost"
          size="icon"
          nativeButton={false}
        >
          <Search className="size-4" />
        </Button>
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
