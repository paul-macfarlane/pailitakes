# Epic: SEO & Launch (SEO)

Metadata, sitemap, mobile polish, launch. Ref: FR-9.5; technical-design.md §5.8.

- [ ] **SEO-1** — Per-post Metadata API: title, derived description, canonical URL, Open Graph / Twitter card (`og:image` = thumbnail). _(deps: POST-5)_
- [ ] **SEO-2** — `sitemap.xml` route handler over visible posts, revalidated by tag `post-list`. _(deps: POST-2)_
- [ ] **SEO-3** — `robots.txt` disallowing `/admin`. _(deps: none)_
- [ ] **SEO-4** — Mobile-first QA pass across all public pages, comment threads, embeds, and interactions. _(deps: all public epics)_
- [ ] **SEO-5** — Launch checklist: env/secrets set per environment, migrations applied, cron job configured, OAuth clients verified. _(deps: SEO-4)_
- [ ] **SEO-6** — Privacy Policy and Terms of Service pages (static public routes) + footer links from all public pages; privacy copy must reflect the salted-hash analytics posture (§8) and comment moderation. _(deps: none; requested 2026-07-12 by Paul)_
- [ ] **SEO-7** — Edge-fade scroll affordance (+ optional scroll-snap) on the home category pill rail so overflow is discoverable on phones (FR-9.4). Pattern itself stays a horizontal chip rail (standard for filters; scales with admin-added categories). _(deps: none; requested 2026-07-12 by Paul)_
