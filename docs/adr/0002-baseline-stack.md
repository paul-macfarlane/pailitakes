# 0002. Baseline stack and architecture

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** docs/technical-design.md (all sections), docs/product-doc.md

## Context

Paulitakes needs a stack that is cheap to operate, mobile-first, fast for public reads, and supports authenticated engagement with near-zero manual moderation. The full evaluation and rationale for each choice is in `docs/technical-design.md`, which is locked at v0.3.

## Decision

Adopt the stack and architecture defined in `docs/technical-design.md` as the project baseline: Next.js App Router on Vercel, Neon Postgres with Drizzle, Better Auth (Google + Discord), Tailwind + shadcn/ui, unified markdown pipeline, Claude Haiku comment moderation via Vercel AI Gateway, Postgres FTS, self-hosted analytics, and Recharts dashboards. Public pages are ISR with tag-based invalidation; interactive data (comments, likes, view beacon) lives in small client islands. Public visibility is a query predicate, not a job.

This ADR exists so the baseline is citable by number; the technical design doc remains the detailed source of truth. Deviations from it during implementation get their own superseding ADRs.

## Consequences

- One authoritative baseline; later ADRs express deltas against it rather than restating the whole stack.
- If an implementation reality forces a change (e.g. a library choice proves unworkable), record a new ADR and update the technical design doc in the same change.
