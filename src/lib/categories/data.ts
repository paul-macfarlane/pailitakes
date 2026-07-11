import "server-only";

// Pure DB access for the admin-only category CRUD screen (SRCH-1, FR-2.1).
// Business rules (slug derivation, conflict/not-found signaling,
// revalidation) live in src/lib/categories/service.ts.

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { categories } from "@/db/schema";

export type CategoryRow = {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

// Every category, active or not — the admin management screen (SRCH-1).
export async function listAllCategories(): Promise<CategoryRow[]> {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      active: categories.active,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

// Single category by slug, active or not — /categories/[slug] (SRCH-2). A
// deactivated category's own page stays reachable (deactivation only hides
// it from listActiveCategories/pickers), so this deliberately doesn't filter
// on `active` the way listActiveCategories does.
export async function getCategoryBySlug(
  slug: string,
): Promise<{ slug: string; name: string } | undefined> {
  const [row] = await db
    .select({ slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row;
}

export type CategoryOption = { id: number; slug: string; name: string };

// Active categories only, for pickers (editor category select) and the
// public category index (FR-2.1: deactivating hides a category from these,
// it is not an unpublish of its posts).
export async function listActiveCategories(): Promise<CategoryOption[]> {
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

// Empty return array means the slug already exists — onConflictDoNothing
// leaves no row to return rather than throwing 23505, same idiom as
// src/lib/posts/data.ts's tag upsert.
export async function insertCategory(input: {
  slug: string;
  name: string;
}): Promise<CategoryRow[]> {
  return db
    .insert(categories)
    .values(input)
    .onConflictDoNothing({ target: categories.slug })
    .returning({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      active: categories.active,
      sortOrder: categories.sortOrder,
    });
}

// Slug is deliberately not part of `patch` — it's derived from the name only
// at create time and never changes on rename (SRCH-1, public /categories/
// [slug] URLs must not break). Returns undefined when `id` doesn't exist.
export async function updateCategory(
  id: number,
  patch: { name?: string; active?: boolean; sortOrder?: number },
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .update(categories)
    .set(patch)
    .where(eq(categories.id, id))
    .returning({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      active: categories.active,
      sortOrder: categories.sortOrder,
    });
  return row;
}
