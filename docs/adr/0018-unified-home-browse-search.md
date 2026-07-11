# 0018. Unified home browse/search surface

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** FR-2.4 (amended), FR-3.1–3.3, technical-design.md §2 (route table), §3, §5.5, §6; amends [0017](0017-category-management-semantics.md); SRCH-2/SRCH-5 follow-up (owner feedback)

## Context

Epic 03 shipped search and category browsing as separate destinations (`/search`, `/categories/[slug]`) because the locked route table made `/` a fully CDN-cached ISR page that reads no request data. Two rounds of owner feedback pushed the other way: category pills should filter the posts page in place, the search bar should live there too, and the two should combine (`category` AND `q`). That requires the home page to read query params, which changes its rendering class.

## Decision

`/` is the single browse/search surface, driven by optional, combinable `q` and `category` params. The page declares no `use cache`; a static shell (title, skeleton) prerenders and one Suspense section reads `searchParams` — partial prerender instead of full-page ISR. The data layer is unchanged: browse modes read the existing `use cache` + `post-list`-tagged feeds; `?q=` search stays uncached. `/search` and `/categories/[slug]` are deleted (no redirects — they were live for under a day). `/tags/[slug]` is untouched. Category deep links are `/?category=slug`; an unknown or deactivated slug degrades to an empty/filtered feed rather than a 404, preserving ADR-0017's reachability decision in param form. The header search icon is removed — the brand link already lands on the search surface.

## Consequences

One surface, one mental model, and category+search compose for free. The cost: `/` serves a streamed dynamic section per request instead of pure cached HTML — cheap at this scale because every browse read is a tag-cached data hit, but a real change to the locked route table (recorded here, table updated). FR-2.4's "public listing page" for categories is now the filtered home view (product doc amended); tags keep dedicated pages. Old `/search`/`/categories/*` URLs 404 — acceptable pre-launch; add redirects if they ever accrue external links. Revisit if home traffic ever makes per-request rendering costly (restore a fully static default-feed fast path).
