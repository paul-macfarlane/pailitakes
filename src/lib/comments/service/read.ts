import "server-only";

// Business logic for the comment-tree read (CMT-2, design D5), used by
// GET /api/comments. DB access lives in src/lib/comments/data.ts; tree
// assembly/redaction lives in src/lib/comments/tree.ts.

import {
  loadCommentRowsForPost,
  loadPostForComment,
} from "@/lib/comments/data";
import { buildCommentTree, type CommentNode } from "@/lib/comments/tree";

export type CommentThread = {
  meta: { commentsLocked: boolean };
  comments: CommentNode[];
};

export type LoadCommentThreadResult =
  { ok: true; thread: CommentThread } | { ok: false; reason: "not-found" };

// Fetches ALL statuses for the post in one query and assembles the tree in
// memory (design D5): a generalization of "visible+deleted" so an edit that
// flags a parent (turning it `rejected`) still keeps its visible replies
// attached via buildCommentTree's placeholder rule, instead of orphaning
// them. Bodies of non-visible rows never leave the server — buildCommentTree
// redacts before this ever gets serialized.
export async function loadCommentThread(
  postId: string,
  viewerId: string | null,
): Promise<LoadCommentThreadResult> {
  const post = await loadPostForComment(postId);
  if (!post) {
    return { ok: false, reason: "not-found" };
  }

  const rows = await loadCommentRowsForPost(postId, viewerId);
  return {
    ok: true,
    thread: {
      meta: { commentsLocked: post.commentsLocked },
      comments: buildCommentTree(rows),
    },
  };
}
