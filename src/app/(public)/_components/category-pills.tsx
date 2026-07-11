import Link from "next/link";

import { cn } from "@/lib/utils";

function categoryHref(slug: string | undefined, q: string | undefined) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (slug) params.set("category", slug);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

const PILL_CLASSES =
  "block whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors";
const PILL_ACTIVE_CLASSES = "border-primary bg-primary text-primary-foreground";
const PILL_INACTIVE_CLASSES =
  "border-border text-muted-foreground hover:bg-muted hover:text-foreground";

// Server-safe presentational (no "use client"): rendered inside home's
// dynamic Suspense section (ADR-0008) now that category browsing is a home
// query param rather than its own cached route (owner-approved fold of
// /search + /categories/[slug] into home, epic 03 SRCH). Every href
// preserves `q` so a search and a category filter compose (`/?category=nba
// &q=nuggets`) — that's the combinability the fold exists for.
export function CategoryPills({
  categories,
  activeSlug,
  q,
}: {
  categories: { slug: string; name: string }[];
  activeSlug?: string;
  q?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-2">
        <li>
          <Link
            href={categoryHref(undefined, q)}
            className={cn(
              PILL_CLASSES,
              !activeSlug ? PILL_ACTIVE_CLASSES : PILL_INACTIVE_CLASSES,
            )}
            aria-current={!activeSlug ? "page" : undefined}
          >
            All
          </Link>
        </li>
        {categories.map((category) => {
          const active = category.slug === activeSlug;
          return (
            <li key={category.slug}>
              <Link
                href={categoryHref(category.slug, q)}
                className={cn(
                  PILL_CLASSES,
                  active ? PILL_ACTIVE_CLASSES : PILL_INACTIVE_CLASSES,
                )}
                aria-current={active ? "page" : undefined}
              >
                {category.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
