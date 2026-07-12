"use server";

// Server actions are the security boundary (design §8, §9): assume hostile
// input on every call, never trust the client, and re-check session + role
// + ownership per action — middleware/UI gating is convenience only.
//
// createComment/editComment read getSession() directly rather than going
// through actionSession(Action.CreateComment): a banned caller must surface
// as a typed CommentDenialReason (design D2) so the UI can show "You're
// banned from commenting" instead of a generic error, and actionSession
// would flatten that straight to null (it already folds bannedAt into
// canPerformAction internally). The service still re-checks canPerformAction
// itself as defense in depth. Every other action here has only one outcome
// on denial (a generic ActionResult error), so actionSession is the right
// fit for them.

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import {
  commentIdSchema,
  createCommentSchema,
  editCommentSchema,
  postIdSchema,
} from "@/lib/comments/input";
import {
  createComment as createCommentService,
  editOwnComment,
} from "@/lib/comments/service/create";
import {
  deleteComment as deleteCommentService,
  setPostCommentsLocked as setPostCommentsLockedService,
} from "@/lib/comments/service/manage";
import {
  approveHeldComment as approveHeldCommentService,
  restoreRejectedComment as restoreRejectedCommentService,
} from "@/lib/comments/service/moderation-log";
import {
  CommentSubmitStatus,
  type CommentSubmitResult,
} from "@/lib/comments/submit-result";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

export async function createComment(
  input: unknown,
): Promise<CommentSubmitResult> {
  const session = await getSession();
  if (!session) {
    return { status: CommentSubmitStatus.Error, message: NOT_AUTHORIZED_ERROR };
  }

  const parsed = createCommentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: CommentSubmitStatus.Error,
      message: parsed.error.issues[0]!.message,
    };
  }

  return createCommentService(
    parsed.data.postId,
    parsed.data.parentId,
    parsed.data.body,
    session.user,
  );
}

export async function editComment(
  id: unknown,
  input: unknown,
): Promise<CommentSubmitResult> {
  const session = await getSession();
  if (!session) {
    return { status: CommentSubmitStatus.Error, message: NOT_AUTHORIZED_ERROR };
  }

  const idResult = commentIdSchema.safeParse(id);
  if (!idResult.success) {
    return {
      status: CommentSubmitStatus.Error,
      message: idResult.error.issues[0]!.message,
    };
  }
  const parsed = editCommentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: CommentSubmitStatus.Error,
      message: parsed.error.issues[0]!.message,
    };
  }

  return editOwnComment(idResult.data, parsed.data.body, session.user);
}

export async function deleteComment(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  // Any non-banned commenter may delete their own comment (own-ownership
  // check happens in the service); admins additionally get the
  // ManageAnyComment bypass there too. CreateComment is the right gate here
  // (every role that can comment can attempt to delete one of their own) —
  // no typed denial reason is needed for delete, so actionSession is fine.
  const session = await actionSession(Action.CreateComment);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = commentIdSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return deleteCommentService(idResult.data, session.user);
}

export async function setCommentsLocked(
  postId: unknown,
  locked: unknown,
): Promise<ActionResult<{ postId: string; locked: boolean }>> {
  const session = await actionSession(Action.ManageAnyComment);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = postIdSchema.safeParse(postId);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }
  const lockedResult = z.boolean().safeParse(locked);
  if (!lockedResult.success) {
    return { ok: false, error: "Invalid request." };
  }

  return setPostCommentsLockedService(idResult.data, lockedResult.data);
}

export async function approveHeldComment(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.ModerateComments);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = commentIdSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return approveHeldCommentService(idResult.data);
}

export async function restoreRejectedComment(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.ModerateComments);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = commentIdSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return restoreRejectedCommentService(idResult.data);
}
