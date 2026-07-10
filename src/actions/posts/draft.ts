"use server";

// Publish/discard a public post's staged edits (posts.draft, ADR-0011).
// Server actions are the security boundary — see src/actions/posts/crud.ts.

import { z } from "zod";

import { staffSession } from "@/lib/auth/guards";
import {
  discardPostChangesService,
  publishPostChangesService,
} from "@/lib/posts/service/draft";
import type { ActionResult } from "@/lib/shared/action-result";

export async function publishPostChanges(
  id: string,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return publishPostChangesService(idResult.data, session);
}

export async function discardPostChanges(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return discardPostChangesService(idResult.data, session);
}
