# 0011. Staged edits for public posts (draft-of-published)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Related:** technical-design.md §4 (posts data model), §5.7 (authoring); FR-7.4; owner feedback (admin-notes.md #2)

## Context

The editor autosaves every ~5s straight to the post row, and `updatePost` calls `revalidateTag` immediately. For a **published** post that means every keystroke reaches the public site within seconds — there is no way to revise a live post privately and publish the revision as a unit. The owner asked for "a draft state that lets me edit without publishing" on an already-public post.

The four-status model (`draft/scheduled/published/archived`) has no room for this: a post has exactly one body, and moving a published post back to `draft` to edit it takes it **offline** while you work. We wanted the live post to stay up, untouched, while edits accumulate privately.

This deviates from the locked design (v0.3), so it is recorded here and the design doc (§4, §5.7) is updated.

## Decision

Add a nullable `posts.draft` **jsonb** column (plus `draft_updated_at`) holding a **complete, publishable content snapshot** — title, slug, body, category, thumbnail/banner/video, tags. It is the source for "Publish changes"; validated by `postDraftSchema` (post-input.ts).

- **Routing (`updatePost`):** edits to a post that is **publicly visible right now** (`isPubliclyVisible()` — status + `publish_at`/`archive_at`, not status alone) merge into `posts.draft` and **do not revalidate** public caches; the live post is untouched. Everything not yet public — drafts, archived posts, and a `scheduled` post still awaiting its `publish_at` — writes straight through, so a scheduled post simply publishes whatever it was last edited to (staging those would strand the edits, since nothing promotes the buffer when the scheduled time arrives). The merge folds the partial autosave diff onto the current snapshot, or onto the live content on the first staged edit, so the buffer always holds a whole snapshot. A staged edit that reverts back to the live content clears the buffer rather than leaving a no-op "pending" state. Slug collisions are surfaced at stage time (a query against the live `slug` column, since the staged slug has no unique constraint), matching the immediacy of the old live-write path.
- **Promote / discard:** `publishPostChanges` applies the snapshot to the live columns + tags in one transaction, clears the buffer, and revalidates (`post-list`, new + old `post:{slug}`). `discardPostChanges` clears the buffer with no revalidation. Both are ownership-scoped server actions, idempotent when nothing is staged.
- **Invariant:** a post with a pending snapshot **cannot** change status or (re)schedule until the changes are published or discarded (`transitionPostStatus`, `schedulePublish`, `scheduleArchive` reject; the UI disables those controls). This keeps the buffer from being stranded on a post that leaves the published/scheduled set — no merge-on-transition or silent-loss edge cases.
- **Reads:** `getEditablePost` / `getPostForPreview` overlay the snapshot when present (and flag `hasPendingChanges`), so the editor edits the pending copy and the preview shows what will go live. The editor labels staged saves "Saved to draft" and reveals a sibling "Unpublished changes" island (publish/discard) after the first staged save.

### Alternatives considered

- **A `post_revisions` table (full history).** More than asked for; the buffer is transient (one pending snapshot, promoted or discarded). A jsonb column keeps the snapshot — including its tag set — in one place with no extra joins. Revision history can layer on later if wanted.
- **Separate draft-of-each-column columns.** Would scatter the snapshot and still need a separate mechanism for the M2M tag set. One jsonb value read/written as a whole fits how the editor and preview consume it.
- **Merge/promote the buffer automatically on status change** (instead of the resolve-first invariant). Rejected: every variant either silently discards edits or promotes content that may be invalid for the target status. An explicit "publish or discard first" gate is predictable and loss-free.

## Consequences

- Public search (`search` tsvector, generated from the **live** title/body) and `visiblePostsWhere()` are unaffected by staged edits — the public sees only promoted content. Correct by construction.
- `updatePost` gains a branch and a per-edit merge read for public posts; the hot path for drafts is unchanged.
- **Concurrency:** every buffer write CAS-guards on `draftUpdatedAt` (and status), and `publishPostChanges` promotes under the same CAS inside its transaction — a concurrent autosave that re-stages between read and write yields a conflict ("reload and try again"), never a silent lost update. The lifecycle actions additionally CAS on `draft is null`, so a first-stage edit racing a status change / (re)schedule can't strand an invisible buffer on a now-non-public post; one side wins, the other gets a conflict.
- The staged slug is checked for collisions at stage time _and_ at promote time (the DB `slug` unique constraint is the final backstop; a clash there rolls the promote back with the buffer preserved).
- **Resolve = full reload:** the "Publish changes" / "Discard changes" island reloads the edit page rather than a soft `router.refresh`, because the editor island seeds its form + refs from `initialPost` only on mount — a soft refresh would leave it showing stale (e.g. discarded) values and re-stage an inconsistent buffer.
- New surface to keep in sync with the post content shape: `postDraftSchema`, the `posts.draft` `$type`, and the overlay/merge sites. Covered by unit tests (staging, promote, discard, no-op revert, stage-time slug collision, scheduled-writes-live, guards, overlay) and an e2e (edit-published stays private until published).
