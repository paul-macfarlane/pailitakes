# 0027. Author post deletion, admin post transfer, and narrowed account-deletion refusal

- **Status:** Accepted
- **Date:** 2026-07-15
- **Related:** FR-7.9, FR-7.10, FR-10.4, technical-design.md §4, §5.7, §5.9, PR #16 feedback round, ADR-0026

## Context

PR #16 review feedback on ACCT-1 flagged that ADR-0026's blanket refusal — any staff account that had ever authored a post could not self-delete — was too coarse: an author with nothing but abandoned drafts had no path to delete their own account without admin intervention on every single request. Two gaps needed closing: authors had no way to remove their own never-public posts (only archive, which is recoverable and stays visible in the admin dashboard), and admins had no way to reassign a departing user's posts to someone else.

There is no `first_published_at` or publish-history column on `posts` (deliberately deferred — see the data model in §4), so "has this post ever been public" can't be read off a single column. Two transitions make current `status` alone insufficient: published→draft is a legal, existing edit-flow transition (the post is a draft now but was public), and a `scheduled` post whose `publish_at` has already passed is live under the visibility predicate (§4) even though its stored `status` may still read `scheduled` until the daily cron normalizes it. A permanent-delete predicate keyed only on `status` would therefore let an author erase a post real readers saw, and — because comments cascade on post delete — silently destroy other people's comment threads on it.

## Decision

- **`Action.DeletePost` is granted to Author** (previously admin-only via `ManageAnyPost`). The capability check is unchanged in shape — `canPerformAction(user, Action.DeletePost)` — but the service layer scopes an author's delete with ownership plus a "never public and commentless" guard, collapsed into **one CAS-guarded `DELETE`** so the check-then-act is atomic without a transaction:

  ```sql
  DELETE FROM posts
  WHERE id = $post_id
    AND author_id = $self
    AND status IN ('draft', 'scheduled')
    AND (publish_at IS NULL OR publish_at > now())
    AND NOT EXISTS (SELECT 1 FROM comments WHERE comments.post_id = posts.id)
  ```

  `status IN ('draft','scheduled')` combined with `publish_at IS NULL OR publish_at > now()` rules out both gap transitions above: a reverted published→draft post is excluded only by the comments guard (see Consequences), and a scheduled post past its `publish_at` fails the `publish_at > now()` clause even if `status` hasn't been normalized yet. The no-comments guard protects bystander threads on a post that was once public and reverted to draft with zero comments — the one case the status/time predicate alone can't distinguish from a genuinely-never-public draft.
  - `Action.ManageAnyPost` remains the bypass: admin hard-delete is unchanged (any status, any author, per §5.7's existing admin-only delete).
  - The edit page's delete control now renders for owners of Draft/Scheduled posts as a visibility hint; the guarded `DELETE` is the actual enforcement, matching the "action checks are the security boundary" rule (§8).

- **Admin post transfer:** gated on `Action.ManageAnyPost` (it's a posts mutation, not a user-management action), surfaced on the admin users screen. Bulk-reassigns every post authored by one user to another user who is currently active staff (role Author or Admin, not banned) via `UPDATE posts SET author_id = $target WHERE author_id = $source`. Revalidates `post-list` plus every affected `post:{slug}` tag, since public post pages render the author byline (FR-1.7).

- **Account deletion (amends ADR-0026):** inside the same locked transaction used for the last-active-admin check and comment anonymization, the never-public/commentless-post purge (same predicate as the author self-delete path, scoped to the deleting user) now runs first. The refusal for "staff with authored posts" narrows to whatever remains after the purge — i.e. posts that were ever public, or that have comments. The refusal message points the user at the site owner to use the new transfer flow (or an admin hard-delete) to clear those posts before deletion can proceed.

- **Transfer/account-deletion race:** a transfer landing on a user mid-deletion (after their purge step, before the row delete) is not additionally locked — it's backstopped by the existing FK RESTRICT on `posts.author_id`. If a post lands on the deleting user between the purge and the `user` row delete, the row delete fails loudly rather than silently orphaning the post or partially completing the deletion.

## Consequences

- The published→draft reversion edge is deliberately still deletable by its author, but **only** when the reverted draft has zero comments — accepted because a commentless post leaves nothing for the guard to protect, and requiring the guard to hold even for that case would mean no author-initiated draft could ever be purged without an admin, defeating the point of this ADR.
- A permanently-deleted post's formerly-public slug 404s afterward — identical behavior to the pre-existing admin hard-delete path (§5.7); no new SEO/redirect concern introduced.
- The transfer race is backstopped by a database constraint rather than an application-level lock, consistent with this repo's general preference (§ engineering rules) for a single guarded statement over cross-request locking where the DB already enforces the invariant.
- Revisit this predicate if a `first_published_at` (or similar publish-history) column is ever added: it would let the guard test "never public" directly and drop the commentless carve-out for the published→draft edge case.
