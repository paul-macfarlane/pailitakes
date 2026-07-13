# Epic: Analytics (ANLY)

Privacy-conscious self-hosted view tracking + admin dashboard. Ref: FR-8.x; technical-design.md §5.6, §8.

- [x] **ANLY-1** — `page_views` schema + indexes `(post_id, created_at)`, `(created_at)`. _(deps: POST-1)_
- [x] **ANLY-2** — Beacon endpoint `/api/view`: compute `visitor_hash = sha256(daily_salt + ip + ua)`, drop known bot UAs, insert row. No raw IP/UA stored. _(deps: ANLY-1)_
- [x] **ANLY-3** — Client beacon component: `navigator.sendBeacon('/api/view', ...)` once per pageview on public pages. _(deps: ANLY-2)_
- [x] **ANLY-4** — Aggregate query lib: traffic over time, top posts, views by category, per-post views, engagement (comments/likes). _(deps: ANLY-1)_
- [x] **ANLY-5** — Admin analytics dashboard using shadcn/ui chart components (Recharts). _(deps: ANLY-4, ADM-1)_
