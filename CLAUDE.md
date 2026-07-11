# Paulitakes

Mobile-first sports blog. Solo project. Multi-author from day one. Full spec lives in `docs/`.

## Read first

- **Product:** `docs/product-doc.md` — features, roles, functional requirements (FR-x.y).
- **Technical design:** `docs/technical-design.md` — locked architecture, data model, key flows. Source of truth for _how_.
- **Engineering rules:** `.claude/rules/engineering.md` — standards every change must follow (imported below).
- **Backlog:** `backlog/` — work split by epic. Pick tasks from here.
- **Decisions:** `docs/adr/` — architecture decision records.

## Stack (see technical-design.md §1 for rationale)

Next.js App Router · TypeScript · Vercel · Neon Postgres (Docker locally) · Drizzle ORM · Better Auth (Google + Discord) · Tailwind + shadcn/ui · TanStack Query (comments + dashboard only) · unified (remark/rehype) markdown · Claude Haiku via Vercel AI Gateway (comment moderation) · Postgres FTS · Recharts.

## Project layout

`src/app/(public)` public pages · `src/app/admin` role-gated authoring · `src/app/api` route handlers · `src/db/schema.ts` Drizzle schema · `src/lib` shared logic (queries, markdown, moderation, ratelimit, auth) · `src/actions` server actions. Full sketch in technical-design.md §6.

## Working here

- **Git flow:** feature branches branch off **`staging`** and PRs target `staging`; `staging` → `main` promotes to prod (design §7). Pushing feature branches needs no confirmation; anything touching `staging`/`main` prompts (FND-9 hook).
- **Backlog-driven.** Use `/task` to run a task through the implementation pipeline (plan → implement → review → test → document → done). `/backlog` shows status. `/feedback` applies a round of human review feedback through the same machinery.
- **Model routing — three tiers.** The session model orchestrates (plans, dispatches, reconciles), the `implementer` subagent (Sonnet) executes self-contained mechanical coding, and the `evaluator` subagent (Opus) adversarially reviews the result; the orchestrator adjudicates disagreements between the two. Plans are fed by read-only `scout` subagents (Sonnet) that gather current-state facts. Details in `/task` and `/feedback`.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/technical-design.md`, update the design doc too.
- The design doc is _locked at v0.3_ — deviate only with a recorded reason.

@.claude/rules/engineering.md
