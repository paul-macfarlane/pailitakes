# 0013. Thin actions/route handlers + domain-organized `src/lib` layering

- **Status:** Accepted
- **Date:** 2026-07-10
- **Related:** ADR-0012 (normalized post draft table); ADR-0009 (admin gate); technical-design.md §6 (project structure); PR #3 review

## Context

PR #3's review flagged two structural problems as the codebase grew past the initial admin-authoring epic:

1. **Fat actions.** `src/actions/posts.ts` had grown to 1,192 lines, mixing zod validation, business rules (staged-edit semantics, CAS guards, status transitions), and inline Drizzle queries in the same functions. That made the file hard to navigate, hard to unit test in isolation (business logic couldn't be exercised without a mocked action/DB round trip), and hard to reuse — the editor preview and the cron revalidation job each needed pieces of the same logic and had started duplicating it.
2. **Flat `src/lib`.** A single `src/lib` directory had reached ~40 files with no internal grouping — auth, posts, users, markdown, and cross-cutting helpers all sat side by side, so nothing signaled which files belonged together or which layer (business logic vs. DB access) a given file was. Auth guard checks were also duplicated slightly differently across a few call sites rather than sharing one predicate module.

The design doc's project-structure sketch (§6) already showed `src/lib` and `src/actions` as flat top-level groupings, so this is a deviation from the locked v0.3 sketch that needs a recorded reason.

## Decision

- **Actions and API route handlers are thin boundaries only:** validate input (zod) → check auth (a guard) → delegate to a domain service. No business logic or DB access inline in an action or route handler.
- **`src/lib` is reorganized by domain**, each domain a folder: `auth/` (session, permissions, roles, guards, redirect-target, Better Auth client), `posts/` (posts, status, input, autosave, admin, home-feed, revalidation), `users/` (admin, display-name), `content/` (markdown, excerpt, image-src), and `admin/` for cross-domain admin-screen helpers (route-params, search) that don't belong to a single domain. `shared/` holds domain-agnostic utilities (cache, env, sql-like, action-result). `src/lib/utils.ts` stays at the root — shadcn's generators hardcode the `@/lib/utils` import path, so moving it would fight the tooling on every future `shadcn add`.
- **Within a domain, a service/data split:** `service*.ts` holds business logic (server-only) and is what actions/route handlers call; `data.ts` holds all Drizzle access for that domain — pure queries/mutations plus error classification, no business rules. A service never reaches around `data.ts` to touch Drizzle directly; nothing outside `data.ts` imports the schema/db client for that domain.
- **`src/lib/auth/authz.ts` is renamed to `src/lib/auth/permissions.ts`** as part of the reorg — "authz" and "permissions" were being used interchangeably across call sites; standardizing on one name removes the ambiguity.
- **A file that accretes unrelated responsibilities gets split** along those responsibilities rather than left to grow. `src/actions/posts.ts` is split into `src/actions/posts/{crud,draft,lifecycle}.ts`; `src/lib/posts/service.ts` is similarly split into `src/lib/posts/service/{crud,draft,lifecycle,shared}.ts`.
- **Component placement rule:** components used by more than one route segment live in `src/components` (shadcn primitives in `src/components/ui`); a component used by exactly one route segment is colocated in a `_components/` folder next to that segment, instead of defaulting everything into `src/components`.
- `.claude/rules/engineering.md` is updated with these as standing rules (thin boundaries, domain/service/data layering, split-on-accretion, component colocation) so they're enforced on every future change, not just this refactor.

## Consequences

- Easier: business logic is unit-testable without going through an action or a mocked request; a domain's DB access is grep-able in one `data.ts` instead of scattered inline; a service or its data layer can be swapped without touching callers (loose coupling, per engineering.md); new contributors can find "where does X live" by domain name instead of scanning a 40-file flat list.
- Harder: more files and more indirection for simple changes — a one-line fix to a query now touches `data.ts` and possibly `service.ts` rather than a single action file; the domain boundary occasionally requires a judgment call (e.g. `admin/` for cross-domain admin-screen helpers) that a flatter structure didn't force.
- `technical-design.md` §6 is updated to sketch the domain folders, the `actions/posts/` split, the service/data layering, and the `_components/` colocation rule — the design doc is locked at v0.3, so this ADR is the recorded reason for that layout change (individual component filenames are intentionally omitted from the sketch since component placement is still being migrated file-by-file).
- Complements ADR-0012: that ADR normalized the draft _storage_ (jsonb column → `post_drafts` table); this ADR reorganizes the _code_ that reads and writes it (`src/lib/posts/data.ts` now holds the draft-table access ADR-0012 introduced, called from `src/lib/posts/service/draft.ts`).
