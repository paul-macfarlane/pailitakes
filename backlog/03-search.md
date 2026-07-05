# Epic: Categories, Tags & Search (SRCH)

Fixed categories, freeform tags, and Postgres full-text search. Site is launchable after this epic (comments off). Ref: FR-2.x, FR-3.x; technical-design.md §5.5.

- [ ] **SRCH-1** — Admin category management (add/rename/deactivate; `active` + `sort_order`). _(deps: ADM-1, POST-1)_
- [ ] **SRCH-2** — Public category and tag listing pages (ISR, `revalidate: 60`, tag `post-list`), newest first. _(deps: POST-2)_
- [ ] **SRCH-3** — Inline tag creation while authoring; any number of tags per post. _(deps: ADM-2, POST-1)_
- [ ] **SRCH-4** — Search query lib: `websearch_to_tsquery` + `ts_rank` + `ts_headline` snippets; tag/category name match; optional category filter. _(deps: POST-2)_
- [ ] **SRCH-5** — `/search` page: dynamic (never cached), debounced input, results show thumbnail/title/category/date/snippet. _(deps: SRCH-4)_
