# 0003. Testing strategy

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** technical-design.md (no testing section — this fills that gap), backlog FND-10, FND-8; `.claude/rules/engineering.md`

## Context

The technical design doc is locked but says nothing about testing. The engineering rules require tests for business logic, and the goal is a pipeline autonomous enough that agents pick up tasks with limited human review. Automated tests are the safety net that makes that autonomy trustworthy — without them, the `/task` "test" step degrades to "did it build." A framework choice is needed so tests are written consistently.

## Decision

- **Vitest** for unit/integration tests of `src/lib` (visibility predicate, excerpt, markdown pipeline, rate limiting, moderation verdict handling) and server actions. Fast, ESM-native, Vite-aligned with the Next stack.
- **Playwright** for end-to-end coverage of a small set of critical flows (publish → visible post, comment create + moderation outcome, like toggle, admin auth gate). Not exhaustive UI coverage — high-value paths only.
- Tests run in CI on every PR (FND-8) and are part of the `/task` pipeline's automated test step. Business logic in `src/lib` and server actions is expected to ship with tests; UI is verified by running the flow plus targeted Playwright specs.

## Consequences

- The autonomous pipeline gains a real, enforceable safety net rather than a build check.
- Small ongoing cost: lib/action changes carry test updates; CI is slower by the test run.
- Playwright needs a browser in CI and a seeded test DB — folded into the FND-8 CI setup. Revisit adding coverage thresholds once the suite matures.

## Addendum — DB-backed integration tests (2026-07-05, POST-2)

Query-layer logic (visibility predicate, query helpers) is tested against **real Postgres** — the local Docker DB or CI's service container — not mocks; the SQL semantics (tsvector, time boundaries, aggregation) are the thing under test. Supporting decisions:

- A Vitest `globalSetup` applies Drizzle migrations before the suite (idempotent; module-relative paths). In CI any failure is fatal; locally every failure only warns, so DB-free unit tests always run without Postgres.
- Tests resolve the connection string via `src/test/db-url.ts`, which reads `.env` without mutating `process.env`, and **refuses non-local hosts unconditionally** — tests migrate and write to the database they're pointed at, and an ambient `DATABASE_URL` left pointing at Neon must never be touched (CI's `DATABASE_URL` is its localhost service container, so no exemption is needed).
- Suites sharing the dev DB isolate by unique per-run identifiers and reserved time windows, clean up after themselves, and only age/reference-gated sweeps touch rows from other runs.
- DB-backed test files mock `@/db` (via `vi.hoisted` + `vi.mock`) with a pool built from the test URL, keeping `src/lib/env.ts` (which validates unrelated env vars) out of the import graph.
