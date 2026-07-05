# 0005. Neon serverless websocket driver (not neon-http) for deployed database access

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** technical-design.md §1 ("serverless driver in deployed envs"), §5.2 (transactional comment insert); `.claude/rules/engineering.md` (transactions for multi-step writes); backlog FND-3

## Context

The design doc mandates Neon's serverless driver in deployed envs but doesn't say which flavor. `@neondatabase/serverless` offers two: the HTTP driver (`drizzle-orm/neon-http`, lowest latency per query) and the websocket `Pool` (`drizzle-orm/neon-serverless`). The HTTP driver does not support interactive transactions, which the engineering rules and design flows require (post + tags insert, moderation verdict + comment insert).

## Decision

Deployed environments (detected via `VERCEL`) use the websocket `Pool` from `@neondatabase/serverless` with `drizzle-orm/neon-serverless`; local dev uses `pg` against Docker Postgres. Both are exposed from `src/db/index.ts` under one `Db` type (`NodePgDatabase`), which both drivers structurally satisfy for our usage.

## Consequences

- `db.transaction(...)` works identically in all environments; callers never branch on driver.
- Slightly higher per-connection latency than neon-http; acceptable since reads that matter are ISR-cached.
- The Neon instance is presented as `NodePgDatabase` via a cast — if the drivers' APIs ever diverge on something we use, TypeScript won't catch it at the boundary; revisit if drizzle ships a shared database type.
