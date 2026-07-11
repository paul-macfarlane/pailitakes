import "server-only";

// Business logic for the admin-only category CRUD screen (SRCH-1, FR-2.1).
// Locked invariant: slug is derived from the name ONLY at create time and
// never changes on rename — public /categories/[slug] URLs (built next task)
// must never break. DB access lives in src/lib/categories/data.ts.

import { revalidateTag } from "next/cache";

import { slugifyCore } from "@/lib/shared/slug";
import { GENERIC_ERROR, type ActionResult } from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";
import {
  type CategoryRow,
  insertCategory,
  updateCategory,
} from "@/lib/categories/data";

// Category names render inline on cached public post listings (home,
// category/tag index) tagged "post-list"; per-post pages aren't tagged by
// category so they self-heal via their own 60s cacheLife rather than being
// revalidated here (design §3).
function revalidateCategoryReads(): void {
  revalidateTag("post-list", IMMEDIATE);
}

export async function createCategoryService(
  name: string,
): Promise<ActionResult<CategoryRow>> {
  // slugifyCore, NOT slugifyTitle — slugifyTitle's "post" fallback for an
  // unslugifiable title is wrong here: it would let two differently-worded,
  // both-unslugifiable category names silently collide on the same slug.
  const slug = slugifyCore(name);
  if (!slug) {
    return {
      ok: false,
      error: "Category name must contain letters or numbers.",
    };
  }

  try {
    const [row] = await insertCategory({ slug, name });
    if (!row) {
      return {
        ok: false,
        error: "A category with that name already exists.",
      };
    }

    revalidateCategoryReads();
    return { ok: true, data: row };
  } catch (err) {
    console.error("createCategory failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function updateCategoryService(
  id: number,
  patch: { name?: string; active?: boolean; sortOrder?: number },
): Promise<ActionResult<CategoryRow>> {
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  try {
    // Slug is NOT derived from `patch.name` here — a rename changes only the
    // `name` column, keeping the create-time slug stable forever (SRCH-1).
    const row = await updateCategory(id, patch);
    if (!row) {
      return { ok: false, error: "Category not found." };
    }

    revalidateCategoryReads();
    return { ok: true, data: row };
  } catch (err) {
    console.error("updateCategory failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
