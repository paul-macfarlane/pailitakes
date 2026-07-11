import Link from "next/link";

import { cn } from "@/lib/utils";

// Server-safe presentational (no "use client"): rendered on the cached home
// shell and the category detail page alike, neither of which needs a client
// island for a row of links.
export function CategoryPills({
  categories,
  activeSlug,
}: {
  categories: { slug: string; name: string }[];
  activeSlug?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-2">
        {categories.map((category) => {
          const active = category.slug === activeSlug;
          return (
            <li key={category.slug}>
              <Link
                href={`/categories/${category.slug}`}
                className={cn(
                  "block whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
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
