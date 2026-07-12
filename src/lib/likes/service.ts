import "server-only";

// Business logic for setPostLike/setCommentLike (LIKE-2), following the
// design §5.4 desired-state model: liked=true inserts (idempotent via
// onConflictDoNothing), liked=false deletes (idempotent — no row is a
// no-op), and the authoritative post-write count is always returned so an
// optimistic client reconciles. DB access lives in src/lib/likes/data.ts;
// input validation happens in the thin action (src/actions/likes.ts).

import { Action, canPerformAction } from "@/lib/auth/permissions";
import {
  countCommentLikes,
  countPostLikes,
  deleteCommentLike,
  deletePostLike,
  insertCommentLike,
  insertPostLike,
  loadLikeableComment,
  loadLikeablePost,
  loadPostLikeState,
  type PostLikeState,
} from "@/lib/likes/data";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

// Public read, used by GET /api/likes — no auth/ban check (anyone, including
// signed-out visitors, can see a post's like count), just the visibility
// gate already applied in loadPostLikeState.
export async function getPostLikeState(
  postId: string,
  viewerId: string | null,
): Promise<PostLikeState | null> {
  return loadPostLikeState(postId, viewerId);
}

// Loose shape (mirrors CommentAuthor, src/lib/comments/service/create.ts):
// Better Auth's session.user types role as a plain string, and this service
// has no reason to couple to the full Session type.
export type LikeActor = {
  id: string;
  role?: string | null;
  bannedAt?: Date | null;
};

export const BANNED_LIKE_MESSAGE = "You're banned from liking.";

// No typed discriminated-union result (unlike CommentSubmitResult): the
// likes UI only ever displays `error` as a string, never branches on why —
// so ActionResult's plain error string is enough here.
export async function setPostLike(
  postId: string,
  liked: boolean,
  actor: LikeActor,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  if (actor.bannedAt) {
    return { ok: false, error: BANNED_LIKE_MESSAGE };
  }
  if (!canPerformAction(actor, Action.LikeContent)) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const post = await loadLikeablePost(postId);
  if (!post) {
    return { ok: false, error: "Post not found." };
  }

  if (liked) {
    await insertPostLike(postId, actor.id);
  } else {
    await deletePostLike(postId, actor.id);
  }
  const likeCount = await countPostLikes(postId);
  return { ok: true, data: { liked, likeCount } };
}

export async function setCommentLike(
  commentId: string,
  liked: boolean,
  actor: LikeActor,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  if (actor.bannedAt) {
    return { ok: false, error: BANNED_LIKE_MESSAGE };
  }
  if (!canPerformAction(actor, Action.LikeContent)) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const comment = await loadLikeableComment(commentId);
  if (!comment) {
    return { ok: false, error: "Comment not found." };
  }

  if (liked) {
    await insertCommentLike(commentId, actor.id);
  } else {
    await deleteCommentLike(commentId, actor.id);
  }
  const likeCount = await countCommentLikes(commentId);
  return { ok: true, data: { liked, likeCount } };
}
