# Paulitakes

Mobile-first sports blog. Solo project. Multi-author from day one. Full spec lives in `docs/`.

## Read first

- **Vision:** `docs/vision.md` — why the site exists and how to judge work: the goal is shipping posts, not the platform.
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

- **Git flow:** feature branches branch off **`staging`** and PRs target `staging`; `staging` → `main` promotes to prod (design §7). Pushing feature branches needs no confirmation; anything touching `staging`/`main` prompts (guard hook in `.claude/hooks/`).
- **Execution model.** Work comes from `backlog/`, in build order. `/task` delivers it — clarify → execute → test & review → share; `/backlog` shows status and what's next; `/feedback` applies a review round; `/ask` answers questions read-only; `/adr` records decisions; `/verify` is the launch-and-drive recipe. The one custom agent is `evaluator`: a fresh-context review, mandatory on diffs touching auth/ownership gating, the visibility predicate, comment moderation/rate limiting, or a migration.
- **Parallel sessions.** A second session works in a sibling worktree from `/worktree` (it copies the env files a bare `git worktree add` silently omits). The dev DB on :5434 and the Playwright e2e suite are shared state — e2e runs one session at a time, and the later branch rebases on `staging` after an earlier PR merges.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/technical-design.md`, update the design doc too — it is **locked at v0.3**, so deviating needs a recorded reason.
- **The shell is zsh.** Quote a glob meant for the _tool_ rather than the shell (`grep --include='*.ts'`) — unquoted, zsh tries to expand it first and the command dies with `no matches found`. In a compound command that `cd`s, use absolute paths afterwards: relative ones resolve against the new directory and fail quietly, which is how a capture ends up half-empty rather than obviously broken.

## Guardrails

- Protected branches: `staging` and `main` — changes land through PRs; never merge a PR (human-only).
- Never read or write live secret files; use `.env.example` and ask a human to populate live values out of band.
- Never force-push, bypass hooks, destroy uncommitted work, repoint remotes, or weaken guardrails.
- Terraform/CDK/kubectl mutations are denied in `.claude/settings.json`. **Vercel is not denied**: its protection is `.claude/hooks/guard-destructive.sh`, which _prompts_ on `vercel --prod`/`promote`/`rollback` (and on `drizzle-kit push|migrate` against a non-localhost `DATABASE_URL`). Treat a prompt as a stop, not a formality.
- Permission precedence is `deny` over `ask` over `allow`, regardless of specificity. A permission mode that suppresses prompts can bypass an `ask`; it cannot override a `deny` or an enforcement hook.

## Tracker

Local markdown in `backlog/` — one file per epic, stable IDs, four checkbox states (`[ ]`/`[~]`/`[x]`/`[!]`), deps-based availability. Build order is the epic table in `backlog/README.md` (design §9). GitHub Issues is unused — never `gh issue create` here. Conventions live in `backlog/README.md`.

@.claude/rules/engineering.md
