# 0019. Page-link pagination everywhere; load-more removed

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** [0018](0018-unified-home-browse-search.md), technical-design.md §2 (route table), FR-3.3; owner feedback 2026-07-11

## Context

The home feed and tag pages paginated with a `LoadMorePosts` client island fetching `/api/posts`. Two problems surfaced in owner testing: load-more accumulates instead of paging (the owner wants a fixed amount per view), and the island's appended-posts state survives `?category=` navigations — React reconciles the component in place across searchParams changes, so posts loaded under NFL stayed visible after switching to NBA. Search mode already paginated with server-rendered `?page=` links.

## Decision

All public feeds paginate with server-rendered Previous/Next links on a shared `?page=` param — the search-mode pattern generalized (one `FeedPagination` component). The URL `{q, category, page}` is the entire pagination state: filters select the result set, `page` walks it, any filter change drops `page` (already encoded in the pill/search-box href builders), and pagination links preserve the active filters. Page size unified at 10 everywhere (search was 20). `LoadMorePosts` and `/api/posts` are deleted. The tags page adopts the home page's shell+Suspense pattern so it can read `?page=`; its feed data keeps its own `use cache` + `post-list` tag.

## Consequences

The state-leak bug class is structurally gone — nothing client-side holds feed state. Browse pages cache per (filter, page) via the existing tagged feeds; search pages stay uncached. Trade-offs accepted: the tags page's unknown-slug `notFound()` now fires inside a streamed boundary, so it can return a soft 404 (200 + not-found UI) instead of a status-line 404 — acceptable for a secondary surface pre-launch; and readers lose infinite-scroll ergonomics in exchange for stable, shareable page URLs. Revisit if analytics ever show deep pagination as a common path (numbered page links) or if tag-page SEO starts to matter (restore a cached, path-segmented variant).
