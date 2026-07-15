"use server";

// Admin-only user management (ADM-10, FR-4.8/10.2). Server actions are the
// security boundary: every call re-checks admin, and the single invariant on
// role/ban changes is "never leave zero active admins" (src/lib/users/service.ts).

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import { ROLE_VALUES } from "@/lib/auth/roles";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import {
  setUserBannedService,
  setUserRoleService,
  transferUserPostsService,
} from "@/lib/users/service";

// Better Auth ids are short opaque strings, not necessarily uuids — bound
// the length without forcing a specific format.
const userIdSchema = z.string().min(1).max(255);
const roleSchema = z.enum(ROLE_VALUES);

export async function setUserRole(
  userId: unknown,
  role: unknown,
): Promise<ActionResult<{ id: string; role: string }>> {
  if (!(await actionSession(Action.ManageUsers))) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Invalid user." };
  }
  const roleResult = roleSchema.safeParse(role);
  if (!roleResult.success) {
    return { ok: false, error: "Invalid role." };
  }

  return setUserRoleService(idResult.data, roleResult.data);
}

export async function setUserBanned(
  userId: unknown,
  banned: unknown,
): Promise<ActionResult<{ id: string; banned: boolean }>> {
  if (!(await actionSession(Action.ManageUsers))) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Invalid user." };
  }
  const bannedResult = z.boolean().safeParse(banned);
  if (!bannedResult.success) {
    return { ok: false, error: "Invalid request." };
  }

  return setUserBannedService(idResult.data, bannedResult.data);
}

// Gated on ManageAnyPost, not ManageUsers: this mutates posts.authorId, not
// the user row (the target's own role/ban state is untouched) — it's a
// posts mutation reachable from the users screen, so it takes the posts
// ownership-bypass capability the same as any other admin-acts-on-any-post
// action (§5.7).
export async function transferUserPosts(
  fromUserId: unknown,
  toUserId: unknown,
): Promise<ActionResult<{ transferred: number }>> {
  if (!(await actionSession(Action.ManageAnyPost))) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const fromResult = userIdSchema.safeParse(fromUserId);
  if (!fromResult.success) {
    return { ok: false, error: "Invalid user." };
  }
  const toResult = userIdSchema.safeParse(toUserId);
  if (!toResult.success) {
    return { ok: false, error: "Invalid user." };
  }

  return transferUserPostsService(fromResult.data, toResult.data);
}
