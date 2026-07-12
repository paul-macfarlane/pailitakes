# Epic: Likes (LIKE)

Toggleable likes on posts and comments. Ref: FR-5.x; technical-design.md §5.4.

- [x] **LIKE-1** — `post_likes` and `comment_likes` schema (composite PKs → idempotent by construction). _(deps: POST-1, CMT-1)_
- [x] **LIKE-2** — Like toggle server actions (insert/delete on composite PK; ban check at action level). Banned tap fails gracefully with a short message (toast/tooltip), not a silent no-op; no site-wide ban banner (§350 — banned users still read normally). _(deps: LIKE-1; scope added 2026-07-09 by Paul)_
- [x] **LIKE-3** — Like button UI with `useOptimistic`; counts via `COUNT(*)`, fetched with comment tree / inlined for post button. _(deps: LIKE-2)_
