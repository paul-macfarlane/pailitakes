# 0012. Normalize the staged-draft buffer into `post_drafts`

- **Status:** Accepted
- **Date:** 2026-07-10
- **Related:** ADR-0011 (staged edits for public posts); technical-design.md §4 (posts data model); PR #3 review

## Context

ADR-0011 added a nullable `posts.draft` jsonb column (plus `posts.draft_updated_at`) holding a complete, publishable content snapshot staged on an already-public post. It worked, but PR #3's review raised a schema-drift risk: the jsonb payload's shape is enforced only in application code (`postDraftSchema` in `src/lib/posts/input.ts`, plus a Drizzle `$type` that's read-side ergonomics only, not a runtime guarantee). Nothing at the database level stops the column from drifting out of sync with `postDraftSchema` as the post content shape evolves (a renamed/added/removed field on `posts` has no corresponding constraint on `posts.draft`), and the jsonb blob is opaque to `\d posts`, foreign keys, and column-level tooling.

The buffer is still exactly what ADR-0011 described: a single pending snapshot per post, promoted or discarded as a whole, never queried by its individual fields. A normalized table is a natural fit and closes the drift risk without changing the feature's semantics.

## Decision

Move the buffer into its own table, `post_drafts`, with `post_id` as its primary key (FK to `posts.id`, `ON DELETE CASCADE`) and one real column per snapshot field (`title`, `slug`, `body_md`, `thumbnail_url`, `banner_url`, `video_url`, `category_id` with its own FK, `tags`, `updated_at`). `posts.draft` / `posts.draft_updated_at` are dropped.

- **A row existing IS "this post has pending changes."** No separate null-vs-present flag is needed — `hasPendingChanges` / `hasDraft` become an existence check (`EXISTS`/`NOT EXISTS` against `post_drafts`, or a LEFT JOIN whose joined columns are all null) instead of `posts.draft IS [NOT] NULL`.
- **Tags stay as NAMES** (`text[]`), not a normalized many-to-many like `post_tags` — deliberately. Real tag rows are only created (via `setPostTags`) when a draft is **promoted**; discarding or deleting a draft therefore never leaves orphan tag rows behind. Normalizing the draft's tag set into real rows up front would require either a parallel `post_draft_tags` join table (cleanup on every discard) or creating live tag rows speculatively for content that may never publish.
- **The CAS token moves with it:** `post_drafts.updated_at` replaces `posts.draft_updated_at` as the compare-and-swap value every buffer write (stage/clear/promote) checks. It is still set explicitly on every write, not via `$onUpdate` — the caller needs to read back and compare the exact value it last wrote, which an automatic hook can't guarantee.
- **Concurrency control moves from a single-statement `UPDATE ... WHERE` to an explicit transaction:** the old design got its CAS-plus-status-guard atomicity for free from Postgres row locking on one `UPDATE posts SET draft = ...` statement. With the buffer in a second table, `writeStagedDraft`, `clearStagedDraft`, and `promoteStagedDraft` (`src/lib/posts/data.ts`) each open a transaction that first locks the `posts` row (`SELECT ... FOR UPDATE`), re-reads `post_drafts.updated_at` under that lock, and only then writes — so every draft-buffer mutation for a given post still serializes against the others, matching the old guarantee (no lost updates, a race reports a conflict) rather than weakening it.
- **Reads** (`getEditablePost`, `getPostForPreview`, `loadOwnedDraft`, `loadStageDraftBase`) LEFT JOIN `post_drafts` in the same query that reads `posts` — one round trip, no N+1 — via a shared `draftJoinColumns` selection and `draftFromJoinRow` reassembly helper in `src/lib/posts/data.ts`.
- **Migration:** one hand-edited migration (`drizzle/0007_sad_luke_cage.sql`) that creates `post_drafts` (+ FKs), backfills any live `posts.draft` rows into it (reading the jsonb's camelCase keys, since a JS object's keys are stored verbatim regardless of the surrounding column's snake_case name), then drops the two source columns — safe to run against a staging DB with pending drafts in place.

### Alternatives considered

- **Leave the jsonb column, add a CHECK constraint or a jsonb-schema validator.** Postgres has no native JSON Schema validation; a hand-rolled CHECK expression would be brittle and unreadable, and still leaves the payload opaque to tooling. Doesn't address the core complaint.
- **Normalize tags into a `post_draft_tags` join table too.** Rejected for the reason above — it would need its own cleanup path on discard/delete that the flat `text[]` avoids entirely, for a field that's never queried relationally (only ever read/written as a whole set).

## Consequences

- Easier: the draft's shape is now enforced by real columns and FKs (a category deleted out from under a draft is a real FK violation, not a silent dangling id in jsonb); `\d post_drafts` documents the shape; future column-level tooling (e.g. a lint rule) can see it.
- Harder: buffer writes are now a short transaction (row lock + read + write) instead of one statement — more code in `src/lib/posts/data.ts`, though the CAS/status-guard semantics are identical and covered by the same test suite (ADR-0011's promote/discard/conflict/overlay tests, updated only where they asserted the storage shape, not behavior).
- External behavior is unchanged: same exported server actions, same return shapes, same user-facing messages, same conflict/idempotency semantics. This ADR is purely a storage-layer change.
- `normalizePostStatuses` (the ADM-9 revalidation cron) now clears a stranded draft via `DELETE FROM post_drafts` inside the same transaction as its archive `UPDATE`, rather than nulling two columns in one statement — same "self-healing, idempotent" guarantee.
