"use server";

// Post lifecycle actions (ADM-4/ADM-5): immediate status transitions and
// scheduled publish/archive. Server actions are the security boundary — see
// src/actions/posts/crud.ts.

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import {
  cancelScheduledArchiveService,
  scheduleArchiveService,
  schedulePublishService,
  transitionPostStatusService,
} from "@/lib/posts/service/lifecycle";
import { POST_STATUSES, type PostStatus } from "@/lib/posts/status";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

export async function transitionPostStatus(
  id: string,
  to: string,
): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  // Session/role before parsing anything (engineering rules: session -> role
  // -> everything else).
  const session = await actionSession(Action.PublishPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const toResult = z.enum(POST_STATUSES).safeParse(to);
  if (!toResult.success) {
    return { ok: false, error: "Invalid status." };
  }

  return transitionPostStatusService(idResult.data, toResult.data, session);
}

export async function schedulePublish(
  id: string,
  publishAtInput: unknown,
): Promise<ActionResult<{ id: string; publishAt: string }>> {
  const session = await actionSession(Action.PublishPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const dateResult = z.coerce.date().safeParse(publishAtInput);
  if (!dateResult.success) {
    return { ok: false, error: "Enter a valid date and time." };
  }

  return schedulePublishService(idResult.data, dateResult.data, session);
}

export async function scheduleArchive(
  id: string,
  archiveAtInput: unknown,
): Promise<ActionResult<{ id: string; archiveAt: string }>> {
  const session = await actionSession(Action.PublishPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const dateResult = z.coerce.date().safeParse(archiveAtInput);
  if (!dateResult.success) {
    return { ok: false, error: "Enter a valid date and time." };
  }

  return scheduleArchiveService(idResult.data, dateResult.data, session);
}

export async function cancelScheduledArchive(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.PublishPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return cancelScheduledArchiveService(idResult.data, session);
}
