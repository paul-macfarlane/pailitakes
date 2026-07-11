# Epic: Categories, Tags & Search (SRCH)

Fixed categories, freeform tags, and Postgres full-text search. Site is launchable after this epic (comments off). Ref: FR-2.x, FR-3.x; technical-design.md §5.5.

- [x] **SRCH-1** — Admin category management (add/rename/deactivate; `active` + `sort_order`). New `src/lib/categories` domain + `Action.ManageCategories` (admin-only); slug stable across rename, deactivate-not-delete, initial set seeded by migration 0009 (ADR-0017). _(deps: ADM-1, POST-1)_
- [x] **SRCH-2** — Public category and tag listing pages (ISR, `revalidate: 60`, tag `post-list`), newest first. Plus `/categories` index; category/tag names linkified on cards and post pages; load-more supports filtered feeds. _(deps: POST-2)_
- [x] **SRCH-3** — Inline tag creation while authoring; any number of tags per post. Verified already shipped with ADM-2/ADM-3 (`setPostTags` upsert-by-slug; staged names materialize on promote, ADR-0012). `MAX_TAGS=10` cap kept as an abuse guard (recorded deviation from FR-2.3, ADR-0017). _(deps: ADM-2, POST-1)_
- [x] **SRCH-4** — Search query lib: `websearch_to_tsquery` + `ts_rank` + `ts_headline` snippets; tag/category name match; optional category filter. `src/lib/posts/search.ts`; plain-text snippet markers rendered as `<mark>` client-side (never raw HTML). _(deps: POST-2)_
- [x] **SRCH-5** — `/search` page: dynamic (never cached), debounced input, results show thumbnail/title/category/date/snippet. GET-form fallback works without JS; params degrade via zod `.catch`. _(deps: SRCH-4)_
