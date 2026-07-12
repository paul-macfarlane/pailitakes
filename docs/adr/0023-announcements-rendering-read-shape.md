# 0023. Announcements reuse the single markdown pipeline; expiry is a read-time filter on a 60s-revalidating cached read

- **Status:** Accepted
- **Date:** 2026-07-12
- **Related:** FR-6.1..6.3, technical-design.md §3 (tags), §4 (announcements table), §5.1 (pipeline); ADR-0008; ANN-1..3

## Context

FR-6.1 says announcements are "plain text or minimal Markdown, ~500 character cap," and §4 annotates the column "minimal markdown." That reads like an invitation to build a restricted markdown variant (no embeds, no code blocks) next to the posts pipeline. Separately, `expires_at` needs display semantics: something has to make an expired announcement disappear from a cached homepage without a job or a mutation to trigger `revalidateTag`. And FR-6.2's "most recent few (e.g., 3–5)" leaves the homepage count open.

## Decision

1. **One pipeline.** Announcement bodies render through the same `renderMarkdown()` as posts — same sanitize schema, same processor instance. "Minimal markdown" is author guidance bounded by the 500-char cap, not a second pipeline: §5's security rule ("`rehype-sanitize` on all rendered markdown — posts _and_ announcements") is what actually matters, and a parallel restricted processor would be a second source of truth to keep in sync for zero security gain. The cap itself is enforced in `announcementInputSchema` (zod), not the column type, matching the repo-wide text-over-varchar convention.
2. **Expiry is a query predicate on a cached read.** `getHomeAnnouncements()` is `use cache` + `cacheTag("announcements")` + `cacheLife({ stale: 60, revalidate: 60 })` (the ADR-0008 shape), selecting `expires_at IS NULL OR expires_at > now()`, newest first, limit 3. Markdown renders inside the cached scope (once per revalidation, §5.1). Crossing an expiry therefore takes effect within ≤60s — the same ISR window every public surface already has — with no cron entry; mutations still `revalidateTag("announcements", IMMEDIATE)` for instant effect. The admin list deliberately shows expired rows (with a badge) so they can be revived by extending the date; `expires_at` accepts any date, past included — the filter is the sole semantics.
3. **Homepage shows 3** (`HOME_ANNOUNCEMENTS_LIMIT`), the low end of FR-6.2's range, keeping the mobile-first homepage tight; the section renders at the slot above the browse/search mode branch, so it is visible in search and category views too.

## Consequences

Announcements can technically carry anything posts can (YouTube autolink embeds, code blocks) — harmless at 500 chars, and any future pipeline hardening automatically covers both surfaces. Expired-but-cached announcements can linger up to ~60s; acceptable, identical to scheduled-post visibility. No `announcements` cron sweep exists — unlike scheduled posts, expiry needs no tag revalidation because the page's own `revalidate: 60` re-runs the filtered query. Revisit the single-pipeline choice only if announcements ever need markdown features posts must not have (or vice versa).
