# Paulitakes

Mobile-first sports blog. Solo project. Multi-author from day one. Full spec lives in `docs/`.

## Read first
- **Product:** `docs/product-doc.md` — features, roles, functional requirements (FR-x.y).
- **Technical design:** `docs/technical-design.md` — locked architecture, data model, key flows. Source of truth for *how*.
- **Engineering rules:** `.claude/rules/engineering.md` — standards every change must follow (imported below).
- **Backlog:** `backlog/` — work split by epic. Pick tasks from here.
- **Decisions:** `docs/adr/` — architecture decision records.

## Stack (see technical-design.md §1 for rationale)
Next.js App Router · TypeScript · Vercel · Neon Postgres (Docker locally) · Drizzle ORM · Better Auth (Google + Discord) · Tailwind + shadcn/ui · TanStack Query (comments + dashboard only) · unified (remark/rehype) markdown · Claude Haiku via Vercel AI Gateway (comment moderation) · Postgres FTS · Recharts.

## Project layout
`src/app/(public)` public pages · `src/app/admin` role-gated authoring · `src/app/api` route handlers · `src/db/schema.ts` Drizzle schema · `src/lib` shared logic (queries, markdown, moderation, ratelimit, auth) · `src/actions` server actions. Full sketch in technical-design.md §6.

## Working here
- **Backlog-driven.** Use `/task` to run a task through the implementation pipeline (plan → implement → review → test → document → done). `/backlog` shows status.
- **Model routing.** `/task` keeps planning + integration + code review on the strong session model and delegates cheaper, self-contained work to model-pinned subagents: `implementer` (Sonnet) for mechanical coding, `scribe` (Haiku) for *bulky* mechanical writing only (small edits stay inline). Subagents have isolated context — delegations must carry a full spec.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/technical-design.md`, update the design doc too.
- The design doc is *locked at v0.3* — deviate only with a recorded reason.

@.claude/rules/engineering.md
