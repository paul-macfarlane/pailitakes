# Epic: Admin & Authoring (ADM)

Content lifecycle: editor, drafts, preview, thumbnails, scheduling, and the cron revalidation endpoint. Ref: FR-7.x, FR-1.5/1.6; technical-design.md §4 (visibility-as-query), §5.7.

- [ ] **ADM-1** — Admin route group `/admin/**`: middleware role gate + `noindex`. _(deps: FND-4)_
- [ ] **ADM-2** — Post editor: Markdown input + toggleable preview using the _same_ pipeline as production (server action returns rendered HTML); autosave drafts on interval. _(deps: POST-3, ADM-1)_
- [ ] **ADM-3** — Post CRUD server actions with session+role+ownership checks; `revalidateTag` on mutate. _(deps: POST-2, ADM-1)_
- [ ] **ADM-4** — Draft status + status transitions (draft/scheduled/published/archived); archive is recoverable. _(deps: ADM-3)_
- [ ] **ADM-5** — Schedule publish/archive: `publish_at`/`archive_at` fields; visibility becomes automatic via the query predicate. _(deps: ADM-4)_
- [ ] **ADM-6** — Thumbnail URL field; validate `https://` image; render `next/image` `unoptimized` with explicit dimensions. Also the optional **banner URL** field (`posts.banner_url`, POST-9) with the same https validation. _(deps: ADM-2)_
- [ ] **ADM-7** — Preview route `/admin/preview/[id]` — renders any draft/scheduled post in the public layout, auth-gated. _(deps: ADM-2, POST-5)_
- [ ] **ADM-8** — Dashboard post list with filter (status/category/author) + sort; authors see own, admin sees all. _(deps: ADM-3)_
- [ ] **ADM-9** — Cron endpoint `/api/cron/revalidate` (cron-job.org target): `CRON_SECRET` bearer auth, idempotent, DB-tracked last-run; revalidates tags for posts whose `publish_at`/`archive_at` crossed. _(deps: ADM-5)_
- [ ] **ADM-10** — Admin user management: list users, assign roles (reader/author/admin), ban/unban (FR-4.8, FR-10.2; technical-design.md §5.7 users screen). _(deps: ADM-1)_
