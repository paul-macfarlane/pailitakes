import "server-only";

// Business logic for createComment (CMT-4) and editOwnComment (CMT-7),
// following the exact order in design §5.2/D7. DB access lives in
// src/lib/comments/data.ts; auth/input validation happens in the thin action
// (src/actions/comments.ts) before these run.

import { Action, canPerformAction } from "@/lib/auth/permissions";
import { CommentDenialReason } from "@/lib/comments/denial";
import {
  applyCommentEdit,
  countRecentCommentsByAuthor,
  insertComment,
  isParentDeletedRace,
  loadCommentForEdit,
  loadPostForComment,
  parentIsValidForReply,
} from "@/lib/comments/data";
import { moderateComment } from "@/lib/comments/moderation";
import { CommentStatus } from "@/lib/comments/status";
import type { CommentSubmitResult } from "@/lib/comments/submit-result";
import type { CommentNode } from "@/lib/comments/tree";
import {
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
} from "@/lib/shared/action-result";
import { env } from "@/lib/shared/env";

// Loose shape (mirrors canPerformAction's user param, src/lib/auth/
// permissions.ts): Better Auth's session.user types role as a plain string,
// and this service has no reason to couple to the full Session type.
export type CommentAuthor = {
  id: string;
  name: string;
  image?: string | null;
  role?: string | null;
  bannedAt?: Date | null;
};

const REJECTED_MESSAGE =
  "Your comment wasn't published — it may violate our community guidelines.";
const HELD_MESSAGE = "Your comment is pending review.";

function statusForVerdict(outcome: "allow" | "flag" | "error"): CommentStatus {
  if (outcome === "allow") return CommentStatus.Visible;
  if (outcome === "flag") return CommentStatus.Rejected;
  return CommentStatus.Held;
}

// Rate limit (design D6/§5.2 step 2): two Postgres COUNTs on ALL comment
// statuses (rejected/held spam still burns the limit) by author_id, over the
// trailing minute/hour windows. Also counts edits (countRecentCommentsByAuthor
// ORs in edited_at) — every moderated edit is a fresh moderation call and
// must burn the same budget as a create, so this same check runs from both
// createComment and editOwnComment below. Limits are read from env here, not
// data.ts — data.ts stays pure query/mutation, no config.
// Per-comment edit cooldown. The row-count rate limit above caps how many
// DISTINCT comments an author can create/edit per window, but a single row
// re-edited in a loop only ever contributes 1 to that count — without a
// cooldown, one comment is an unbounded stream of moderation calls. 60s
// matches the per-minute window, so one comment costs at most one moderation
// call per minute.
const EDIT_COOLDOWN_MS = 60_000;

async function isRateLimited(authorId: string, now: Date): Promise<boolean> {
  const oneMinuteAgo = new Date(now.getTime() - 60_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
  const [lastMinute, lastHour] = await Promise.all([
    countRecentCommentsByAuthor(authorId, oneMinuteAgo),
    countRecentCommentsByAuthor(authorId, oneHourAgo),
  ]);
  return (
    lastMinute >= env.COMMENT_RATE_LIMIT_PER_MINUTE ||
    lastHour >= env.COMMENT_RATE_LIMIT_PER_HOUR
  );
}

// design D7, exact step order:
//  1. banned -> denied/Banned
//  2. capability (defense in depth) -> error
//  3. post exists + publicly visible -> denied/Archived
//  4. commentsLocked -> denied/Locked
//  5. parent valid (if replying) -> error
//  6. rate limit -> denied/RateLimited
//  7. moderate -> insert with resulting status, mod_verdict always stored
//  8. `visible` arm returns the full CommentNode (design D7 step 8) so the
//     UI can insert it without refetching the thread.
export async function createComment(
  postId: string,
  parentId: string | null,
  body: string,
  author: CommentAuthor,
): Promise<CommentSubmitResult> {
  if (author.bannedAt) {
    return {
      status: "denied",
      reason: CommentDenialReason.Banned,
      message: "You're banned from commenting.",
    };
  }
  if (!canPerformAction(author, Action.CreateComment)) {
    return { status: "error", message: NOT_AUTHORIZED_ERROR };
  }

  const now = new Date();

  const post = await loadPostForComment(postId, now);
  if (!post) {
    return {
      status: "denied",
      reason: CommentDenialReason.Archived,
      message: "This post is no longer accepting comments.",
    };
  }

  if (post.commentsLocked) {
    return {
      status: "denied",
      reason: CommentDenialReason.Locked,
      message: "Comments are locked on this post.",
    };
  }

  if (parentId !== null) {
    if (!(await parentIsValidForReply(parentId, postId))) {
      return { status: "error", message: "Cannot reply to that comment." };
    }
  }

  if (await isRateLimited(author.id, now)) {
    return {
      status: "denied",
      reason: CommentDenialReason.RateLimited,
      message: "You're commenting too fast. Try again in a bit.",
    };
  }

  const verdict = await moderateComment(body);
  const status = statusForVerdict(verdict.outcome);

  let inserted: { id: string; createdAt: Date };
  try {
    inserted = await insertComment({
      postId,
      parentId,
      authorId: author.id,
      body,
      status,
      modVerdict: verdict.record,
    });
  } catch (err) {
    // The parent-validity check above ran before the (seconds-long)
    // moderation call awaited just above — a hard delete of the parent in
    // that window surfaces here as an FK violation rather than at the
    // earlier check (design D7 steps 5 vs 7).
    if (isParentDeletedRace(err)) {
      return { status: "error", message: "Cannot reply to that comment." };
    }
    console.error("createComment insert failed", err);
    return { status: "error", message: GENERIC_ERROR };
  }

  if (status === CommentStatus.Rejected) {
    return { status: "rejected", message: REJECTED_MESSAGE };
  }
  if (status === CommentStatus.Held) {
    return { status: "held", message: HELD_MESSAGE };
  }

  const node: CommentNode = {
    id: inserted.id,
    parentId,
    body,
    status: CommentStatus.Visible,
    createdAt: inserted.createdAt.toISOString(),
    editedAt: null,
    author: { id: author.id, name: author.name, image: author.image ?? null },
    children: [],
  };
  return { status: "visible", comment: node };
}

// design D7 "Edit": strict ownership (no admin bypass — FR-4.3 is "own
// comments"), only `visible` comments are editable, and the new body is
// re-moderated so editing can't bypass moderation (a flagged edit turns the
// comment rejected). Also rate-limited, same as create: each edit is a fresh
// moderation call and is an unbounded cost vector left unthrottled otherwise
// (fix, supersedes the original "edits don't count" design note).
export async function editOwnComment(
  id: string,
  body: string,
  author: CommentAuthor,
): Promise<CommentSubmitResult> {
  if (author.bannedAt) {
    return {
      status: "denied",
      reason: CommentDenialReason.Banned,
      message: "You're banned from commenting.",
    };
  }
  if (!canPerformAction(author, Action.CreateComment)) {
    return { status: "error", message: NOT_AUTHORIZED_ERROR };
  }

  const existing = await loadCommentForEdit(id);
  if (!existing) {
    return { status: "error", message: "Comment not found." };
  }
  if (existing.authorId !== author.id) {
    return { status: "error", message: NOT_AUTHORIZED_ERROR };
  }
  if (existing.status !== CommentStatus.Visible) {
    return {
      status: "error",
      message: "This comment can no longer be edited.",
    };
  }

  const now = new Date();
  if (
    existing.editedAt &&
    now.getTime() - existing.editedAt.getTime() < EDIT_COOLDOWN_MS
  ) {
    return {
      status: "denied",
      reason: CommentDenialReason.RateLimited,
      message: "You're editing too fast. Try again in a minute.",
    };
  }

  if (await isRateLimited(author.id, now)) {
    return {
      status: "denied",
      reason: CommentDenialReason.RateLimited,
      message: "You're commenting too fast. Try again in a bit.",
    };
  }

  const verdict = await moderateComment(body);
  const status = statusForVerdict(verdict.outcome);

  const editedAt = await applyCommentEdit(id, body, status, verdict.record);

  if (status === CommentStatus.Rejected) {
    return { status: "rejected", message: REJECTED_MESSAGE };
  }
  if (status === CommentStatus.Held) {
    return { status: "held", message: HELD_MESSAGE };
  }

  const node: CommentNode = {
    id,
    parentId: existing.parentId,
    body,
    status: CommentStatus.Visible,
    createdAt: existing.createdAt.toISOString(),
    editedAt: editedAt.toISOString(),
    author: { id: author.id, name: author.name, image: author.image ?? null },
    children: [],
  };
  return { status: "visible", comment: node };
}
