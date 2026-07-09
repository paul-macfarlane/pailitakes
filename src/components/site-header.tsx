import Link from "next/link";

import { HeaderAuth } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";

// Static shell — no request data. Session state renders inside the
// HeaderAuth client island so public pages remain ISR-cacheable (also why
// nav links carry no active-route styling: that would need a client island).
// /categories and /search land with epic 03 (SRCH-2, SRCH-5).
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
            <Link
              href="/categories"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Categories
            </Link>
            <Link
              href="/search"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Search
            </Link>
          </nav>
        </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <HeaderAuth />
      </div>
    </HeaderShell>
  );
}
