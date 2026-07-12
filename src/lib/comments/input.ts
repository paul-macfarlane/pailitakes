// No "server-only" here (mirrors src/lib/posts/input.ts): these schemas
// validate both the comment composer's client-side input and the server
// actions/route handler that re-validate on the server (the actual
// boundary).

import { z } from "zod";

// 2000 chars is an abuse guard, same spirit as posts' MAX_TAGS — not a UX
// limit (design D11).
const MAX_COMMENT_BODY = 2000;

export const commentBodySchema = z.string().trim().min(1).max(MAX_COMMENT_BODY);

export const commentIdSchema = z.uuid();
export const postIdSchema = z.uuid();

// parentId is required-but-nullable (not optional): null means top-level, an
// explicit choice the caller must make rather than an absent key defaulting
// to something.
export const createCommentSchema = z.object({
  postId: postIdSchema,
  parentId: commentIdSchema.nullable(),
  body: commentBodySchema,
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const editCommentSchema = z.object({
  body: commentBodySchema,
});
export type EditCommentInput = z.infer<typeof editCommentSchema>;
