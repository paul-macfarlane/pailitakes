# 0017. Category management semantics: stable slugs, deactivate-not-delete, seeded initial set

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** FR-2.1, FR-2.3, FR-2.4, technical-design.md §5.7 (categories CRUD) and §6 (structure sketch updated: dedicated `/admin/categories` and `/admin/users` screens replace the sketched combined `settings` page), SRCH-1, SRCH-3

## Context

FR-2.1 makes categories an admin-managed list (add, rename, deactivate) and names an initial set, but leaves three semantics open: what a rename does to the category's public URL (`/categories/[slug]`, FR-2.4), what deactivation means for already-published posts in that category, and how the initial set gets into the database. Separately, FR-2.3 says a post can have "any number of tags" while the editor ships a `MAX_TAGS = 10` input cap.

## Decision

- **Slugs are stable.** The slug is derived from the name once, at create time (`slugifyCore`; unslugifiable names are rejected, no placeholder fallback). Rename changes `name` only — public category URLs never break. There is no slug-edit surface.
- **Deactivation is not unpublish.** An inactive category disappears from the editor's category picker and the `/categories` index, but its own listing page stays reachable and its posts stay public. There is no category delete.
- **The FR-2.1 initial set is seeded by an idempotent migration** (`drizzle/0009`, `ON CONFLICT (slug) DO NOTHING`): NFL, NBA, MLB, College Football.
- **Rename propagation rides existing caching:** category mutations `revalidateTag("post-list")`; per-post pages pick up the new name via their 60s `cacheLife` window rather than enumerating `post:{slug}` tags.
- **The `MAX_TAGS = 10` editor cap stands** as a deliberate input-abuse guard, accepted as a bounded deviation from FR-2.3's "any number".

## Consequences

Category URLs are permanent, so renames are safe and links never rot; the trade-off is that a heavily renamed category can drift from its slug (e.g. `college-football` named "NCAAF") with no recourse but creating a new category. Deactivated categories keep old content browsable without a repointing migration. A renamed category shows its old name on post detail pages for up to 60 seconds — accepted over per-post tag enumeration. Revisit the tag cap only if a real authoring need for >10 tags appears.
