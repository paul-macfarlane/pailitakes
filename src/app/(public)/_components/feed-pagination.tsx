import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

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

  const isFirstPage = page <= 1;

  return (
    <Pagination className="mt-8">
      <PaginationContent>
        <PaginationItem>
          {/* Disabled bounds still link somewhere (self) rather than being
              omitted — Base UI's own disabled handling (aria-disabled +
              blocked click) is what actually stops navigation. */}
          <PaginationPrevious
            href={pageHref(isFirstPage ? page : page - 1)}
            disabled={isFirstPage}
          />
        </PaginationItem>
        <PaginationItem>
          {/* size="default" (not the fixed icon square) + min-w-8 so 3-4
              digit page numbers (cap 1000) don't overflow a fixed box. */}
          <PaginationLink
            href={pageHref(page)}
            isActive
            size="default"
            className="min-w-8"
          >
            {page}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href={pageHref(hasMore ? page + 1 : page)}
            disabled={!hasMore}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
