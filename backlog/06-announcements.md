# Epic: Announcements (ANN)

Short admin-only messages on the homepage. Ref: FR-6.x; technical-design.md §4 (announcements table).

- [x] **ANN-1** — `announcements` schema (body ≤500 chars, optional `expires_at`). _(deps: FND-3)_
- [x] **ANN-2** — Admin CRUD: create/edit/delete, minimal markdown (sanitized), optional expiration; `revalidateTag('announcements')`. Admin-only via `Action.ManageAnnouncements`; forms per ADR-0007. _(deps: ANN-1, ADM-1)_
- [x] **ANN-3** — Homepage announcements section: newest first, most recent 3 (ADR-0023), hide expired via read-time filter on the `announcements`-tagged cached read. _(deps: ANN-1, POST-7)_
