---
description: Run a backlog task through the implementation pipeline (plan → implement → review → test → document → done)
argument-hint: <task-id | next | epic-prefix> [--auto] [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

You are executing the standard delivery pipeline for one unit of work. A "task" may be a single backlog item, several related items, or a whole epic — scope it from the argument.

## Model routing (cost/quality)
You (the main session, strong model) own the **judgment-heavy phases: planning, integration, and code review** — never delegate those. Delegate cheaper, well-scoped work to model-pinned subagents to save tokens:
- **`implementer`** (Sonnet) — self-contained coding chunks that follow an established pattern and have no unresolved design decisions (CRUD actions, schema tables, boilerplate components, wiring).
- **`scribe`** (Haiku) — only *bulky* mechanical writing (scaffolding many test files, a large specified doc section). Small edits — flipping a backlog checkbox, a one-line doc change, an ADR index row — are cheaper done inline; don't spin up a subagent for them.

Subagents run with **isolated context** — they see only the prompt you give them. So every delegation must carry the full spec: task ID, files to touch, acceptance criteria, the exact `docs/technical-design.md` §sections and `FR-x.y` that apply, and the pattern to follow. Delegate only genuinely self-contained chunks; keep coupled or judgment-requiring work inline. If a subagent reports a blocker or a needed decision, resolve it yourself (strong model), then re-delegate or finish inline.

## Escalation — ask for a human even in `--auto`
Routine gates are about *preference* (does the human want to review the plan / test by hand). Escalation is about *necessity* — situations where continuing autonomously would mean guessing at something you shouldn't, or doing something unsafe. **Always pause and ask, in every mode including `--auto`, when:**
- **A product or scope decision is genuinely underspecified** — the spec, product doc, and technical design don't determine the answer, and picking wrong would mean meaningful rework. (Don't escalate for choices with a sensible default — pick it, note it, move on.)
- **An architectural choice would deviate from `docs/technical-design.md`** (locked at v0.3) or otherwise set a precedent. Surface it, propose the change, and get agreement before coding — this is also where an ADR is warranted.
- **An action is destructive, irreversible, or outward-facing:** deleting/overwriting non-generated data, running migrations against staging/prod, deploying, rotating or exposing secrets, calling a paid/external service, changing auth/permissions, or anything touching real user data.
- **You're stuck, not progressing:** code review can't be satisfied after ~3 fix loops, tests keep failing for a reason you can't resolve, or the same error recurs. Report what you tried rather than thrashing.
- **Access or prerequisites are missing:** absent credentials/env vars, an unmet dependency task (`deps:` not `[x]`), or tooling that isn't set up.
- **A security or privacy concern** surfaces that isn't already settled in the design (e.g. handling of PII, a sanitization gap, an auth hole).
- **The task is materially bigger or more coupled than its one-line scope implies** — stop and propose splitting it rather than silently ballooning.

How to escalate: pause, state plainly what's blocking and why it needs a human, give your recommended option and the alternatives, and wait. Don't bury it in a status update — make the ask the headline. When unsure whether something clears the bar, prefer asking; a wrong autonomous guess on any of the above costs more than a question.

## 0. Resolve target & gate config
- **Target:** `next` = first `[ ]` todo in build order (respecting `deps:`) across `backlog/`. A task ID (e.g. `POST-3`) = that item. An epic prefix (e.g. `POST`) = that epic's open tasks in order. If nothing is runnable (all blocked/done), say so and stop.
- **Gates** (human-in-the-loop checkpoints — each is a place you *pause and hand control back*):
  - `plan` gate — default **ON**. `--no-plan` or `--auto` turns it off.
  - `test` mode — default **auto**. `--test=manual` gates for the human to test; `--test=skip` only for tasks with no runtime surface (docs/schema-only).
  - `--auto` = autonomous: skip the routine gates (plan, test) and run start to finish. It does **not** mean "never stop" — you must still escalate for genuine intervention per the Escalation section below.
- State the resolved target and gate config in one line before starting. Mark the task `[~]` in its backlog file.

## 1. Plan
Produce a short plan: files to touch, approach, which `docs/technical-design.md` sections and `FR-x.y` apply, and any decision that will need an ADR. Consult `.claude/rules/engineering.md`.
- **Plan gate ON:** present the plan and stop for approval. Do not implement until the user responds.
- **Plan gate OFF:** proceed directly.

## 2. Implement
Write the code following `.claude/rules/engineering.md` and the technical design. Stay within the task's scope. Prefer the relevant Vercel/Next/shadcn/Drizzle skills for framework specifics. If reality forces a deviation from the design doc, note it — it needs an ADR in step 5.

Apply model routing: break the work into chunks and, for each self-contained mechanical chunk with no open design decision, dispatch the `implementer` subagent with a complete spec (per the Model routing note). Do the coupled, cross-cutting, or judgment-requiring parts inline yourself. You are responsible for integrating the pieces into a coherent whole and for their correctness regardless of who wrote them.

## 3. Code review (always automated)
Run `/code-review` on the working diff. Apply the confirmed findings. Re-review after fixes. Loop until the review is clean.
- Unless `--auto`, briefly summarize what review found and what you changed, so the human can intervene if they want — but don't block on it.

## 4. Test
- **auto:** run/build the affected flow (use `/verify` or `/run`) plus any unit tests for lib/action logic. Report results.
- **manual:** describe exactly what to test and how, then stop and wait for the human's result.
- **skip:** only if there's no runtime surface; say why.
- If testing surfaces changes → go back to step 3 (review the fix) before continuing.

## 5. Document & close out
- Decide *what* the docs/ADRs must say and *what* status changes to record — that's your judgment. Do the small edits inline (flip the backlog task to `[x]`, one-line doc changes, the ADR index row). Only delegate to `scribe` if there's a *bulky* mechanical write (e.g. scaffolding a batch of test files), giving it the exact spec.
- Update `docs/` if behavior/architecture changed. Record any non-obvious or design-deviating decision as an ADR (`/adr`), updating `docs/technical-design.md` if the baseline shifted.
- Mark the task `[x]` in its backlog file. Update the ADR index if you added one.
- Re-run `/code-review` on the doc/backlog changes if they touched code-adjacent files; loop to step 3 if it flags anything real.

## 6. Report
Summarize: what shipped, review outcome, test outcome, docs/ADRs touched, task(s) closed, and the next unblocked task. Do **not** commit or push unless the user asked.

Throughout: respect the gates *and* the Escalation rules. A gate is a preference checkpoint you skip in `--auto`; escalation is a necessity checkpoint you honor in **every** mode. `--auto` runs start to finish on its own — but stops the moment it hits anything in the Escalation section, states the ask clearly, and waits.
