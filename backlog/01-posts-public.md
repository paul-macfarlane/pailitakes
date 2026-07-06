# Epic: Posts & Public Site (POST)

Posts data model, markdown rendering, and the public post page + home — static content end-to-end with tag-based caching. Ref: FR-1.x, FR-9.x; technical-design.md §4, §5.1, §9.2.

- [x] **POST-1** — Drizzle schema: `categories`, `posts` (with generated `search` tsvector + GIN index), `tags`, `post_tags`. _(deps: FND-3)_
- [x] **POST-2** — `visiblePostsWhere()` predicate + `src/lib/posts.ts` query helpers (list, by slug). _(deps: POST-1)_
- [x] **POST-3** — Markdown pipeline in `src/lib/markdown.ts`: remark-parse → gfm → rehype → sanitize (allowlist YouTube iframe) → YouTube embed transform → pretty-code → stringify. _(deps: FND-1)_
- [x] **POST-4** — `src/lib/excerpt.ts`: derive excerpt from `body_md` (strip markdown, ~160 chars). Must tolerate truncated input: list queries feed it `excerptSource = left(body_md, 1000)` (see POST-2 review), which can cut a markdown construct mid-token. _(deps: POST-3)_
- [x] **POST-5** — Public post page `/posts/[slug]` (ISR, cache tag `post:{slug}`); renders body, associated video, byline, category, tags. _(deps: POST-2, POST-3, POST-6)_
- [x] **POST-6** — `lite-youtube` click-to-load facade embed component (nocookie). Also swap `rehypeYouTubeEmbeds` in `src/lib/markdown.ts` to emit the facade instead of its interim `loading="lazy"` iframe — design §5.1 mandates the facade pattern for all YouTube embeds (POST-3 review). _(deps: FND-1)_
- [x] **POST-7** — Home page: recent published posts (thumbnail, title, category, author, date, excerpt), ISR `revalidate: 60`, load-more/pagination. Leave a slot for announcements (built in ANN-3). _(deps: POST-2, POST-4)_
- [x] **POST-8** — Global nav (home, categories, search) + mobile-first responsive layout shell. _(deps: FND-2)_
