---
description: Run a backlog task through the implementation pipeline (plan → implement → review → test → document → done)
argument-hint: <task-id | next | epic-prefix> [--auto] [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & gates

- **Target:** `next` = first `[ ]` in build order across `backlog/` whose `deps:` are all `[x]`. A task ID (e.g. `POST-3`) = that item. An epic prefix (e.g. `POST`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- **Gates** (human checkpoints, skipped by `--auto`):
  - `plan-review` — human review of the plan before implementing. **Default OFF**: the plan is written and handed straight to implementation without stopping. `--plan` turns review ON (present the plan and wait for approval); `--no-plan` is the default. A plan is **always** produced regardless of this gate (Pipeline step 1) — the gate only controls whether a human approves it first, never whether a plan exists.
  - `test` — default `auto`; `--test=manual` stops for the human to test; `--test=skip` only when there is no runtime surface.
- State the resolved target and gates in one line, and mark the task `[~]` in its backlog file.

## Model routing — three tiers

You are the **orchestrator**: planning, integration, dispatching, and reconciling stay with you. Delegate self-contained mechanical chunks (established pattern, no open design decisions) to the **`implementer` subagent (Sonnet)**. It sees only your prompt, so each delegation must be a complete spec: task ID, files, acceptance criteria, applicable technical-design §sections and FR-x.y, and the pattern to follow. Completed work is reviewed by the **`evaluator` subagent (Opus)** — see Pipeline step 3. When implementer output and evaluator findings disagree, you adjudicate: trace the code yourself, decide, and record the rationale; the human breaks ties you can't. You own the correctness and integration of everything either agent returns.

Every delegation is built from the Pipeline step-1 plan: hand the implementer the relevant slice of that plan as its spec. The plan is always written and always drives the coding — whether or not a human reviewed it first — so an agent never codes without a plan behind it, even when the plan-review gate is off.

## Pipeline

1. **Plan** — **always** produce a written plan: files to touch, approach, applicable FR-x.y / design-doc sections, any decision needing an ADR. When the plan depends on current-state facts you haven't verified (call sites, existing patterns, coverage), dispatch `scout` agents first rather than planning from memory. The plan is mandatory whether or not a human reviews it — it is what the implementing agent works from (see Model routing), so it must be concrete enough to hand off. If the plan-review gate is on (`--plan`), present the plan and wait for approval before implementing; by default, hand it straight to implementation without stopping.
2. **Implement** — follow `.claude/rules/engineering.md` and the technical design; use the Vercel/Next/shadcn/Drizzle skills for framework specifics.
3. **Review & test** — done when the `evaluator` subagent (Opus), briefed with the diff, the plan, and the task's acceptance criteria, returns a clean verdict (confirmed findings go to an `implementer` to fix, then the same evaluator re-verifies; findings you reject get a recorded rationale), and the affected flow demonstrably works (`/verify` or `/run`, plus unit tests for lib/action logic). `/code-review` remains available for focused single-concern passes. In `--test=manual`, describe what to test and wait for the result.
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
