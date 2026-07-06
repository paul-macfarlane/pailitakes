# 0008. Next 16 Cache Components implement the ISR + cache-tag strategy

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** technical-design.md §3 (caching), backlog POST-5/POST-7; ADR-0002

## Context

The design (§3, locked) prescribes ISR pages with cache tags (`post:{slug}`, `post-list`, `announcements`) invalidated by `revalidateTag(...)`. It was written against the classic App Router model (`export const revalidate`, `unstable_cache`). Next 16 replaced that model: `unstable_cache` is deprecated in favor of Cache Components (`cacheComponents: true`) with the `use cache` directive, `cacheTag()`, and `cacheLife()`. Building new public pages on the deprecated API would bake in a migration; the engineering rules say prefer current framework practice.

## Decision

- `cacheComponents: true` in `next.config.ts`; public pages declare caching with `use cache` + `cacheTag(...)` + `cacheLife({ stale: 60, revalidate: 60 })` — the design's "ISR `revalidate: 60`" expressed in the new model. Mutations still call `revalidateTag(...)` exactly as designed.
- The post page caches at **page level** (`use cache` on the page component), not via a Suspense-wrapped dynamic hole: the 404 status for missing/unpublished slugs must be computed before streaming (a Suspense shell commits a 200 first), and page-level caching reproduces classic ISR semantics — markdown renders once per revalidation.
- Cache Components requires `generateStaticParams` to return ≥1 entry on dynamic segments; CI builds run against an empty database, so the post route returns a never-linked placeholder slug that renders 404 instead of querying for real slugs at build.
- Pages reading request data (session) render it inside `<Suspense>` (sign-in's redirect gate, account's card) so their shells stay prerendered.
- `/search`, `/admin/**`, and comment/like reads stay uncached per §3 — they simply never declare `use cache`.

## Consequences

- Tag-based invalidation works exactly as the design intends, on the supported API; no future `unstable_cache` migration.
- All request-data access anywhere in the app must sit inside `Suspense` or `use cache` boundaries — the build enforces this (a page that forgets fails `pnpm build`, which CI runs).
- The placeholder `generateStaticParams` entry is a wart to revisit if Next lifts the ≥1 requirement, or if we later prerender real slugs at build (needs a DB reachable from the build).
