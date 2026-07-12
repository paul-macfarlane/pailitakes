import "server-only";

// Business logic for deleteComment (CMT-7 own / CMT-8 admin delete-any) and
// setPostCommentsLocked (CMT-8 lock toggle). DB access lives in
// src/lib/comments/data.ts; auth/input validation happens in the thin action
// (src/actions/comments.ts) before these run.

import { Action, canPerformAction } from "@/lib/auth/permissions";
import {
  commentHasChildren,
  hardDeleteCommentIfChildless,
  loadCommentForDelete,
  setPostCommentsLockedColumn,
  softDeleteComment,
} from "@/lib/comments/data";
import {
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

export type CommentActor = {
  id: string;
  role?: string | null;
  bannedAt?: Date | null;
};

// design D8: owner OR the ManageAnyComment bypass (mirrors ManageAnyPost).
// Has children (any status) -> soft delete (status='deleted', body cleared);
// childless -> race-safe hard delete (the DELETE's own NOT EXISTS guard is
// the actual race defense — see hardDeleteCommentIfChildless). Deleting a
// comment whose descendants later all disappear needs no cleanup: the
// read-side pruning (buildCommentTree, design D4) handles display.
export async function deleteComment(
  id: string,
  actor: CommentActor,
): Promise<ActionResult<{ id: string }>> {
  try {
    const existing = await loadCommentForDelete(id);
    if (!existing) {
      return { ok: false, error: "Comment not found." };
    }
    if (
      existing.authorId !== actor.id &&
      !canPerformAction(actor, Action.ManageAnyComment)
    ) {
      return { ok: false, error: NOT_AUTHORIZED_ERROR };
    }

    if (await commentHasChildren(id)) {
      await softDeleteComment(id);
      return { ok: true, data: { id } };
    }

    const hardDeleted = await hardDeleteCommentIfChildless(id);
    if (!hardDeleted) {
      // A child landed between the check above and the delete write — the
      // comment is still removed from view, just as a placeholder rather
      // than gone outright.
      await softDeleteComment(id);
    }
    return { ok: true, data: { id } };
  } catch (err) {
    console.error("deleteComment failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// design D10: comment-feature state stored on posts (ADR-0004).
// Deliberately no revalidateTag — lock state is served via the uncached
// /api/comments meta, so the cached post page never needs invalidation.
export async function setPostCommentsLocked(
  postId: string,
  locked: boolean,
): Promise<ActionResult<{ postId: string; locked: boolean }>> {
  try {
    const updated = await setPostCommentsLockedColumn(postId, locked);
    if (!updated) {
      return { ok: false, error: "Post not found." };
    }
    return { ok: true, data: { postId, locked } };
  } catch (err) {
    console.error("setPostCommentsLocked failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
