---
description: Run a backlog task through the implementation pipeline (plan → implement → review → test → document → done)
argument-hint: <task-id | next | epic-prefix> [--auto] [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & gates

- **Target:** `next` = first `[ ]` in build order across `backlog/` whose `deps:` are all `[x]`. A task ID (e.g. `POST-3`) = that item. An epic prefix (e.g. `POST`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- **Gates** (human checkpoints, skipped by `--auto`):
  - `plan` — default ON; `--no-plan` turns it off.
  - `test` — default `auto`; `--test=manual` stops for the human to test; `--test=skip` only when there is no runtime surface.
- State the resolved target and gates in one line, and mark the task `[~]` in its backlog file.

## Model routing

Judgment work — planning, integration, code review — stays with you. Delegate self-contained mechanical chunks (established pattern, no open design decisions) to the `implementer` subagent. It sees only your prompt, so each delegation must be a complete spec: task ID, files, acceptance criteria, applicable technical-design §sections and FR-x.y, and the pattern to follow. You own the correctness and integration of everything it returns.

## Pipeline

1. **Plan** — files to touch, approach, applicable FR-x.y / design-doc sections, any decision needing an ADR. If the plan gate is on, present it and wait.
2. **Implement** — follow `.claude/rules/engineering.md` and the technical design; use the Vercel/Next/shadcn/Drizzle skills for framework specifics.
3. **Review & test** — done when `/code-review` on the diff comes back clean (apply confirmed findings, re-review) and the affected flow demonstrably works (`/verify` or `/run`, plus unit tests for lib/action logic). In `--test=manual`, describe what to test and wait for the result.
4. **Close out** — docs updated if behavior/architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`.
5. **Report** — what shipped, review/test outcomes, docs/ADRs touched, next unblocked task. Don't commit or push unless asked.

## Escalate — in every mode, including `--auto`

Stop and ask the human when:

- a change would **deviate from `docs/technical-design.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the product doc, design doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.
  Plus your standing defaults for anything destructive, irreversible, outward-facing, or security-sensitive. Make the ask the headline, give your recommendation, and wait.
