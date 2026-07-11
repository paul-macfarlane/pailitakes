// Admin-only category CRUD input (SRCH-1, FR-2.1). No "server-only" here,
// same rationale as src/lib/posts/input.ts: nothing client-side needs these
// yet, but keeping the domain's zod schemas alongside its other pure code
// (rather than inline in the action) matches the posts-domain precedent.

import { z } from "zod";

export const categoryNameSchema = z.string().trim().min(1).max(80);
export const categorySortOrderSchema = z.number().int().min(0).max(10_000);

export const categoryUpdateSchema = z
  .object({
    name: categoryNameSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: categorySortOrderSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No changes to save.",
  });

export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
