"use server";

// Server actions are the security boundary (design §8, §9): assume hostile
// input on every call, never trust the client, and re-check session + role +
// ban status per action — middleware/UI gating is convenience only.
//
// setPostLike/setCommentLike read getSession() directly rather than going
// through actionSession(Action.LikeContent): a banned caller must reach the
// service to get the typed BANNED_LIKE_MESSAGE (design §8 "Banned users:
// checked on comment and like actions") instead of actionSession silently
// folding bannedAt into a generic null (it already checks canPerformAction
// internally, which itself short-circuits on bannedAt). The service still
// re-checks canPerformAction itself as defense in depth.

import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import {
  setCommentLike as setCommentLikeService,
  setPostLike as setPostLikeService,
} from "@/lib/likes/service";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

export async function setPostLike(
  postId: unknown,
  liked: unknown,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(postId);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }
  const likedResult = z.boolean().safeParse(liked);
  if (!likedResult.success) {
    return { ok: false, error: "Invalid request." };
  }

  return setPostLikeService(idResult.data, likedResult.data, session.user);
}

export async function setCommentLike(
  commentId: unknown,
  liked: unknown,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(commentId);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }
  const likedResult = z.boolean().safeParse(liked);
  if (!likedResult.success) {
    return { ok: false, error: "Invalid request." };
  }

  return setCommentLikeService(idResult.data, likedResult.data, session.user);
}
