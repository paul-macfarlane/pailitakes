"use server";

// Admin-only category management (SRCH-1, FR-2.1). Server actions are the
// security boundary: every call re-checks Action.ManageCategories before
// touching input, same ordering as src/actions/users.ts and the rationale in
// src/actions/posts/crud.ts (session/role before parse — an unauthorized
// caller gets only "Not authorized.", never field-level validation feedback
// for input it was never entitled to submit).

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import type { CategoryRow } from "@/lib/categories/data";
import {
  categoryNameSchema,
  categoryUpdateSchema,
} from "@/lib/categories/input";
import {
  createCategoryService,
  updateCategoryService,
} from "@/lib/categories/service";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

const categoryIdSchema = z.number().int().positive();

export async function createCategory(
  input: unknown,
): Promise<ActionResult<CategoryRow>> {
  if (!(await actionSession(Action.ManageCategories))) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const parsed = categoryNameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid category name." };
  }

  return createCategoryService(parsed.data);
}

export async function updateCategory(
  id: unknown,
  patch: unknown,
): Promise<ActionResult<CategoryRow>> {
  if (!(await actionSession(Action.ManageCategories))) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = categoryIdSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: "Invalid category." };
  }
  const patchResult = categoryUpdateSchema.safeParse(patch);
  if (!patchResult.success) {
    return {
      ok: false,
      error: patchResult.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  return updateCategoryService(idResult.data, patchResult.data);
}
