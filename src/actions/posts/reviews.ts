"use server";

import { z } from "zod";
import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import {
  addReviewCommentSchema,
  resolveThreadSchema,
  saveReviewDraftSchema,
  submitReviewSchema,
} from "@/lib/reviews/input";
import {
  addReviewCommentService,
  discardReviewDraftService,
  refreshReviewDraftService,
  saveReviewDraftService,
  setThreadResolvedService,
  startReviewService,
  submitReviewService,
} from "@/lib/reviews/service";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";

// Thin boundaries: session → schema → service. Post access (including
// membership) is checked per request in the service (ADR-0038).
const INVALID = { ok: false, error: "Invalid review input." } as const;
const DENIED = { ok: false, error: NOT_AUTHORIZED_ERROR } as const;

const startSchema = z
  .object({ postId: z.uuid(), replacesProposalId: z.uuid().nullable() })
  .strict();
const postRevisionSchema = z
  .object({ postId: z.uuid(), revision: z.number().int().min(0) })
  .strict();

export async function startReview(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  return startReviewService(
    session,
    parsed.data.postId,
    parsed.data.replacesProposalId,
  );
}

export async function saveReviewDraft(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = saveReviewDraftSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? INVALID.error,
    } as const;
  return saveReviewDraftService(session, parsed.data);
}

export async function refreshReviewDraft(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = postRevisionSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  return refreshReviewDraftService(
    session,
    parsed.data.postId,
    parsed.data.revision,
  );
}

export async function discardReviewDraft(postId: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = z.uuid().safeParse(postId);
  if (!parsed.success) return INVALID;
  return discardReviewDraftService(session, parsed.data);
}

export async function submitReview(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = submitReviewSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  return submitReviewService(session, parsed.data);
}

export async function addReviewComment(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = addReviewCommentSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? INVALID.error,
    } as const;
  return addReviewCommentService(session, parsed.data);
}

export async function setThreadResolved(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return DENIED;
  const parsed = resolveThreadSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  return setThreadResolvedService(session, parsed.data);
}
