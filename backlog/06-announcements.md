# Epic: Announcements (ANN)

Short admin-only messages on the homepage. Ref: FR-6.x; technical-design.md §4 (announcements table).

- [ ] **ANN-1** — `announcements` schema (body ≤500 chars, optional `expires_at`). _(deps: FND-3)_
- [ ] **ANN-2** — Admin CRUD: create/edit/delete, minimal markdown (sanitized), optional expiration; `revalidateTag('announcements')`. _(deps: ANN-1, ADM-1)_
- [ ] **ANN-3** — Homepage announcements section: newest first, most recent 3–5, hide expired. _(deps: ANN-1, POST-7)_
