# 0021. Likes read/write shape: desired-state set actions, session-aware comment tree, tiny post-like fetch route

- **Status:** Accepted
- **Date:** 2026-07-12
- **Related:** FR-5.1, FR-5.2, technical-design.md §5.4 (§8 ban check), LIKE-1..3

## Context

§5.4 locks the mechanism — server action "toggling insert/delete on the composite-PK like tables", `useOptimistic` on the client, counts via `COUNT(*)` fetched with the comment tree or a "tiny dynamic fetch" for the post button — but leaves three shapes open: the action's signature under rapid optimistic taps, how `likedByMe` reaches an until-now anonymous `GET /api/comments`, and what the post button's fetch actually is. A blind `toggle(id)` desyncs when two in-flight taps race (each flips whatever state the server happens to hold); the comments read route never resolved a session before, so per-viewer state had nowhere to ride.

## Decision

1. **Actions take the desired state, not a toggle:** `setPostLike(postId, liked)` / `setCommentLike(commentId, liked)` — like is an `INSERT … ON CONFLICT DO NOTHING` on the composite PK, unlike is a `DELETE` on it. Replays and races are idempotent; the response returns the authoritative `{ liked, likeCount }` for the optimistic layer to reconcile against. Result type is the shared `ActionResult<T>` (no new discriminated union — the UI displays the error string, it never branches on a typed reason; the banned message is a constant, checked via `bannedAt` before `canPerformAction(user, Action.LikeContent)`).
2. **`GET /api/comments` becomes session-aware:** the route resolves `getSession()` and threads `viewerId` into the one tree query, which now carries per-node `likeCount` (correlated count) and `likedByMe` (EXISTS, constant false when anonymous). The route was already dynamic/no-store, so personalizing it changes no caching behavior. Redacted placeholder nodes zero both fields, consistent with stripping body/author.
3. **The post button's "tiny dynamic fetch" is `GET /api/likes?postId=`** returning `{ likeCount, likedByMe }`, session-aware, 404 for non-visible posts — consumed by plain `fetch` in the island (no TanStack, per §1/§5.4).
4. **Both FKs on both like tables cascade** (content side and user side), unlike `comments.author_id`: a like row is a pure join row with no content to lose — the `post_tags` precedent, plus a `user_id` companion index for the user-side cascade path.

## Consequences

Rapid taps, retries, and double-submits are harmless by construction; the client never needs a mutation queue. The comments payload grows two ints per node but stays one query. Anonymous comment-tree responses are no longer viewer-independent in principle (they still are in practice — `likedByMe` is constant false), so any future CDN caching of `/api/comments` is off the table; it was already `no-store` by design. Deleting a user silently removes their likes (counts drop) — acceptable, there's no authored content in a like. FR-5.3 (analytics most-liked) reads the same tables later with no schema change.
