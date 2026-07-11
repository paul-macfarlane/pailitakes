import Link from "next/link";

// Stateless URL pagination shared by home's three modes (search/category/
// default) and /tags/[slug] — replaces the old LoadMorePosts client island,
// which kept appended-posts state across searchParams navigations (a
// category switch left the previous category's appended cards on screen,
// since the island reconciles in place rather than remounting). The URL is
// the only state: Previous/Next just link to `page` ± 1, so switching any
// other filter (which drops `page`, see category-pills.tsx/search-box.tsx)
// resets pagination for free.
export function FeedPagination({
  pathname,
  query,
  page,
  hasMore,
}: {
  pathname: string;
  // Every defined entry is preserved on Previous/Next links (e.g. home's
  // `q`/`category`); tag pages pass `{}` since the tag itself lives in
  // `pathname`, not a query param.
  query: Record<string, string | undefined>;
  page: number;
  hasMore: boolean;
}) {
  if (page <= 1 && !hasMore) return null;

  function pageHref(targetPage: number) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) search.set(key, value);
    }
    if (targetPage > 1) search.set("page", String(targetPage));
    const qs = search.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <nav
      aria-label="Pagination"
      className="mt-8 flex items-center justify-between text-sm"
    >
      {page > 1 ? (
        <Link
          href={pageHref(page - 1)}
          aria-label="Previous page"
          className="hover:underline"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">Page {page}</span>
      {hasMore ? (
        <Link
          href={pageHref(page + 1)}
          aria-label="Next page"
          className="hover:underline"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
