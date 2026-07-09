# 0010. Admin post list is server-rendered with URL-param filters, not TanStack Query

- **Status:** Accepted
- **Date:** 2026-07-07
- **Related:** technical-design.md §3 (caching / uncached admin), §5.7; backlog ADM-8; FR-7.1

## Context

The design (§3, locked) says `/admin/**` reads are "deliberately uncached (client-fetched, no-store) — interactive data freshness is TanStack Query's job." Read literally, the ADM-8 dashboard post list (filter by status/category/author, sort by updated/published) would be a client component using `useQuery` against a new `/api/admin/posts` route, behind a `QueryClientProvider`.

TanStack Query is not yet installed or wired. Its stated rationale is *interactive data freshness* — the reason comments and likes are client-fetched (optimistic updates, near-real-time). A filtered, paginated post list has no such need: it's a read whose inputs are the filter selections.

## Decision

Server-render the admin post list. Filters/sort/page live in the URL search params; the Server Component (`/admin/page.tsx`) parses them (zod, with `.catch` fallbacks) and calls `listAdminPosts()` directly. The route is dynamic and uncached (as §3 requires) because `requireStaff()` reads the session — it is simply uncached via *dynamic server rendering* rather than via a client fetch.

Author scoping is enforced in `listAdminPosts()` (authors hard-scoped to their own rows; a non-admin's `author` filter is ignored), consistent with the rule that server-side checks are the security boundary.

TanStack Query is still the plan for genuinely interactive admin surfaces — comment moderation actions and the Recharts analytics dashboard (§5.7) — and for public comments/likes. This ADR narrows §3's "client-fetched" to those, not to every admin read.

## Consequences

- Simpler: no new dependency, provider, or API route for ADM-8; no loading spinners; filter URLs are shareable and bookmarkable; the list works during hydration and without JS.
- The `/admin/**` = "client-fetched via TanStack Query" statement in §3 is now scoped to interactive reads, not filtered lists — recorded here and noted in the design doc.
- When TanStack Query does land (comments epic), the provider setup is its own task, not retrofitted onto this list.
- Trade-off: filter changes are a full navigation (GET form submit) rather than an in-place refetch. Acceptable for an admin list; revisit only if it feels sluggish.
