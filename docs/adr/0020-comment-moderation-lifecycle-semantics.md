# 0020. Comment moderation and lifecycle semantics

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** FR-4.3, FR-4.6, FR-4.7; technical-design.md §5.2, §5.3; CMT-4..CMT-7

## Context

The design doc locks the comment creation flow (§5.2) and tree read (§5.3) but is silent on four edges the implementation hit: whether edits are re-screened, what deleting a comment does to the stored row, what the read query does when a parent stops being visible while its replies remain, and where the moderation lib lives (the backlog said `src/lib/moderation.ts`, which predates the ADR-0013 domain layout).

## Decision

1. **Edits are re-moderated and consume the create rate limit.** `editOwnComment` re-runs the LLM verdict on the new body (a clean-then-edited comment would otherwise bypass moderation entirely) and counts against the same per-minute/per-hour limits as creates — the data layer counts rows by author where `created_at` _or_ `edited_at` falls in the window — because every edit is a fresh gateway call and would otherwise be an unbounded cost vector. Since a single re-edited row only ever contributes 1 to that count, a per-comment 60s edit cooldown bounds the loop case: one comment costs at most one moderation call per minute.
2. **Delete is soft when the comment has children, hard when childless.** Soft delete sets `status='deleted'` and clears the body (privacy — the placeholder never needs it); hard delete is a single guarded `DELETE … WHERE NOT EXISTS(children)`, race-safe with the `parent_id` FK as backstop.
3. **The thread read fetches all statuses and generalizes the placeholder rule.** Any non-visible node (deleted, held, rejected) is redacted in `buildCommentTree` (body/author stripped server-side) and kept only when it has a visible descendant — generalizing §5.3's "visible+deleted" filter so a flagged edit that turns a parent `rejected` doesn't orphan its visible replies.
4. **Moderation lives in the comments domain** (`src/lib/comments/moderation.ts`, examples in `moderation-examples.ts`), not top-level `src/lib/moderation.ts` — it is comment-only logic and follows the ADR-0013 domain layout. Comment text is delimiter-escaped before prompt interpolation (instruction-only injection defense is insufficient).
5. **Lock state travels through the uncached comments API** (`meta.commentsLocked` on `GET /api/comments`), so toggling `comments_locked` never revalidates the cached post page.

## Consequences

Moderation cannot be bypassed via edit, at the cost of one extra LLM call per edit (bounded by the shared rate limit). A user's edit can demote their own visible comment to rejected/held — the UI must explain that, and the moderation log is the recovery path. Hard-deleted comments are unrecoverable by design; soft-deleted bodies are gone even to admins. Fetching all statuses per thread reads slightly more rows than §5.3's filter; redaction in one pure function keeps the leak surface testable. Revisit the edit rate-limit coupling if edit volume ever crowds out legitimate creates.
