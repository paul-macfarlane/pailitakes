# 0004. `comments_locked` flag on posts

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** FR-4.4, technical-design.md §4 + §5.2, backlog CMT-8

## Context
FR-4.4 lets the admin lock comments on a post, and the comment-creation flow (§5.2 step 1) rejects comments on locked posts — but the locked v0.3 data model had no column carrying that state. A backlog audit surfaced the gap.

## Decision
Add `comments_locked boolean not null default false` to `posts`. The admin lock action toggles it; the create-comment server action checks it. Design doc §4 amended accordingly.

## Consequences
- FR-4.4 is implementable with a one-column change — no new table, no job, existing comments stay visible as required.
- First recorded amendment to the locked design doc, made via the ADR process rather than silently.
