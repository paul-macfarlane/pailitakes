"use server";

// Server actions are the security boundary (design §8, §9): assume hostile
// input on every call, never trust the client, and re-check session + role
// + ownership per action — middleware/UI gating is convenience only.

import { z } from "zod";

import { staffSession } from "@/lib/auth/guards";
import { postInputSchema, postUpdateSchema } from "@/lib/posts/input";
import {
  createPostService,
  deletePostService,
  updatePostService,
} from "@/lib/posts/service/crud";
import type { ActionResult } from "@/lib/shared/action-result";

export async function createPost(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  // Session/role checked before parsing input: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (or a 100KB body parsed) for input it was never
  // entitled to submit (engineering rules: session -> role -> everything
  // else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const parsed = postInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  return createPostService(parsed.data, session.user.id);
}

export async function updatePost(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  // Session/role checked before parsing anything: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (engineering rules: session -> role -> everything
  // else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const parsed = postUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  return updatePostService(idResult.data, parsed.data, session);
}

export async function deletePost(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  // Session/role checked before parsing the id (engineering rules: session
  // -> role -> everything else) — an unauthenticated or unauthorized caller
  // gets only "Not authorized.", never id-format validation feedback.
  const session = await staffSession();
  // Hard delete is admin-only; authors archive instead, which is
  // recoverable (ADM-4/FR-7.6) — deletion is not.
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return deletePostService(idResult.data);
}
