import { z } from "zod";

// Home's (`/`) and /tags/[slug]'s URL params degrade silently (engineering
// rule: public FILTER params never throw) — a junk q/category/page just
// falls back to "no filter"/page 1 rather than 404ing or erroring. Mirrors
// the admin list pages' per-field `.catch()` idiom
// (src/app/admin/users/page.tsx).

// Matches slugifyCore's output shape (src/lib/shared/slug.ts): lowercase
// alphanumeric runs joined by single hyphens, no leading/trailing hyphen.
const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Same cap as the admin search box (src/lib/admin/search.ts) — kept as its
// own constant rather than importing that admin-only module into a public
// route.
export const SEARCH_QUERY_MAX = 100;

// Shared by searchParamsSchema (home, `?page=`) and pageParamsSchema
// (/tags/[slug], `?page=`) — one definition so the two routes' pagination
// can't drift.
const pageField = z.coerce.number().int().positive().max(1000).catch(1);

export const searchParamsSchema = z.object({
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX).optional().catch(undefined),
  category: z.string().regex(SLUG_SHAPE).optional().catch(undefined),
  page: pageField,
});

export type SearchPageParams = z.infer<typeof searchParamsSchema>;

// /tags/[slug]'s searchParams: page-only (the tag itself lives in the path
// param, not a query param).
export const pageParamsSchema = z.object({
  page: pageField,
});

// Home's SEO identity per parsed params (SEO-10). Since ADR-0018 folded
// /search and /categories/[slug] into `/?q=`/`/?category=`, Google saw every
// filtered variant as an uncanonicalised duplicate of `/` ("Duplicate
// without user-selected canonical"). Rules:
// - search mode (`q` set): canonical `/` + noindex — result pages are not
//   content to index, and the query never belongs in a canonical;
// - category-browse mode: `/?category={slug}` IS the category listing
//   (FR-2.4), so it self-canonicalises;
// - bare feed: `/`.
// `page` > 1 is kept in the canonical (self-referencing) — pointing page 2
// at `/` would ask Google to discard the paginated posts.
export type HomeCanonical = { canonical: string; noindex: boolean };

export function homeCanonical(params: SearchPageParams): HomeCanonical {
  if (params.q) return { canonical: "/", noindex: true };
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return { canonical: qs ? `/?${qs}` : "/", noindex: false };
}
