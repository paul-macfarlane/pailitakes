import Link from "next/link";
import { cacheLife } from "next/cache";

// Cache Components forbids `new Date()` in uncached server render (route
// would otherwise error at prerender), so the copyright year is read inside
// a cached scope; `cacheLife("days")` keeps it fresh across a year boundary.
async function getCurrentYear(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

// Static shell — no request data, so it stays out of the way of ISR/cache
// components on public pages (same rationale as SiteHeader).
export async function SiteFooter() {
  const currentYear = await getCurrentYear();

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
        <span>© {currentYear} Paulitakes</span>
        <nav aria-label="Legal" className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="transition-colors hover:text-foreground"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
