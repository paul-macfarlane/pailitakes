# Epic: Comments (CMT)

Nested comment threads with LLM moderation and rate limiting. Ref: FR-4.x; technical-design.md §5.2, §5.3.

- [ ] **CMT-1** — `comments` schema: `parent_id` self-FK, `status` (visible/held/rejected/deleted), `mod_verdict` jsonb, indexes `(post_id, created_at)` + `(status, created_at)`. _(deps: POST-1)_
- [ ] **CMT-2** — Comment tree read route `GET /api/comments?postId=` (`no-store`); one query, tree assembled in memory by `parent_id`. _(deps: CMT-1)_
- [ ] **CMT-3** — Comment tree UI (TanStack Query): nested render, indent to ~depth 5 then flatten with "replying to @name", mobile-first; optimistic insert on allow. _(deps: CMT-2, CMT-4)_
- [ ] **CMT-4** — Create-comment server action: reject if banned/archived/locked, then rate limit, moderate, insert with resulting status. _(deps: CMT-5, CMT-6)_
- [ ] **CMT-5** — Rate limiting lib: Postgres counts by `author_id` (>3/min, >30/hour; values from config). _(deps: CMT-1)_
- [ ] **CMT-6** — Moderation lib `src/lib/moderation.ts`: AI SDK → Vercel AI Gateway → `anthropic/claude-haiku-4.5`; strict JSON verdict, family-friendly policy prompt, few-shot example set in repo, ~5s timeout, fail-closed to `held`. _(deps: FND-5)_
- [ ] **CMT-7** — Edit/delete own comment; deleting a comment with replies leaves a `[deleted]` placeholder. _(deps: CMT-3)_
- [ ] **CMT-8** — Admin: delete any comment; lock comments on a post — adds `comments_locked` to `posts` (FR-4.4, ADR-0004). _(deps: CMT-3, ADM-1)_
- [ ] **CMT-9** — Moderation log screen: browse held/rejected with verdict + reason; approve `held`, restore `rejected` false positives. _(deps: CMT-4, ADM-1)_
