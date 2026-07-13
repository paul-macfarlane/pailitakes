# 0025. Analytics ingest & dashboard decisions

- **Status:** Accepted
- **Date:** 2026-07-13
- **Related:** FR-8.1–8.3, technical-design.md §3, §4, §5.6, §7, §8; ANLY-1..5

## Context

Design §5.6 fixes the analytics flow (sendBeacon → `/api/view` → salted daily
hash; admin Recharts dashboard over aggregate queries) but leaves several
implementation choices open: what happens to view rows when a post is
hard-deleted, how the daily salt is derived, how the endpoint behaves when
unconfigured or when fed bot/stale input, how the dashboard reads its data
(§6's sketch lists no admin read route), and who may see it (FR-8.3 makes
author access optional).

## Decision

- **`page_views.post_id` is `ON DELETE SET NULL`**, not cascade: hard-deleting
  a post must not erase site-traffic history; the row survives as a non-post
  view with its `path`.
- **Daily salt = `sha256(ANALYTICS_SALT_SEED + ":" + UTC date)`**;
  `visitor_hash = sha256(daily_salt + ":" + ip + ":" + ua)`. Raw IP/UA are
  never persisted or logged.
- **Unconfigured seed → 503** (feature disabled rather than open), mirroring
  the `CRON_SECRET` posture on the cron route. The seed stays `.optional()` in
  env validation.
- **Bot UAs and unknown `postId`s are dropped with 204**, indistinguishable
  from success: a cached ISR page can legitimately beacon a hard-deleted
  post's id (FK 23503 → classified, not thrown), and a 204-for-everything
  response gives scrapers no filtering oracle.
- **One admin read endpoint, `GET /api/admin/analytics`**, returns all
  dashboard datasets for a range/granularity in one payload; the dashboard is
  client-fetched with TanStack Query per §3 (uncached). Invalid filter params
  degrade to defaults rather than 400. §6's sketch gains this route.
- **`Action.ViewAnalytics` is admin-only** in v1; FR-8.3's optional
  author-scoped view is deferred.
- **`date_trunc` granularity is inlined as a raw SQL literal** from a closed
  three-value record (never request input): Drizzle mints a fresh bind
  parameter per fragment use, and Postgres's GROUP BY functional-dependency
  check rejects value-identical but syntactically distinct parameters.

## Consequences

Traffic history survives post deletion at the cost of orphaned (null-post)
rows in post-centric cuts, which simply exclude them. No cross-day visitor
correlation is possible — the deliberate flip side is that "unique visitors"
at week/month granularity counts a returning visitor once per active day
(design-sanctioned by §5.6's `count(distinct visitor_hash)`). A nightly
rollup table stays deferred until raw-row aggregates get slow. Adding
author-scoped analytics later means widening `ViewAnalytics` plus an
ownership filter, not a redesign.
