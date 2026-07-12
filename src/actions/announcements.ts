"use server";

// Admin-only announcement management (FR-6.1, FR-6.3). Server actions are the
// security boundary: every call re-checks Action.ManageAnnouncements before
// touching input, same ordering as src/actions/categories.ts and the
// rationale in src/actions/posts/crud.ts (session/role before parse — an
// unauthorized caller gets only "Not authorized.", never field-level
// validation feedback for input it was never entitled to submit).

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import { announcementInputSchema } from "@/lib/announcements/input";
import {
  createAnnouncement as createAnnouncementService,
  deleteAnnouncement as deleteAnnouncementService,
  updateAnnouncement as updateAnnouncementService,
} from "@/lib/announcements/service";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

const expiresAtSchema = z.coerce.date().nullable();

export async function createAnnouncement(input: {
  body: unknown;
  expiresAt: unknown;
}): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.ManageAnnouncements);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const bodyResult = announcementInputSchema.safeParse({
    body: input.body,
  });
  if (!bodyResult.success) {
    return { ok: false, error: bodyResult.error.issues[0]!.message };
  }

  const expiresAtResult = expiresAtSchema.safeParse(input.expiresAt);
  if (!expiresAtResult.success) {
    return { ok: false, error: "Enter a valid expiration date, or none." };
  }

  return createAnnouncementService({
    body: bodyResult.data.body,
    expiresAt: expiresAtResult.data,
  });
}

export async function updateAnnouncement(
  id: string,
  input: { body: unknown; expiresAt: unknown },
): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.ManageAnnouncements);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const bodyResult = announcementInputSchema.safeParse({
    body: input.body,
  });
  if (!bodyResult.success) {
    return { ok: false, error: bodyResult.error.issues[0]!.message };
  }

  const expiresAtResult = expiresAtSchema.safeParse(input.expiresAt);
  if (!expiresAtResult.success) {
    return { ok: false, error: "Enter a valid expiration date, or none." };
  }

  return updateAnnouncementService(idResult.data, {
    body: bodyResult.data.body,
    expiresAt: expiresAtResult.data,
  });
}

export async function deleteAnnouncement(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession(Action.ManageAnnouncements);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return deleteAnnouncementService(idResult.data);
}
