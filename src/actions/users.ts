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
import { setUserBannedService, setUserRoleService } from "@/lib/users/service";

const userIdSchema = z.string().min(1);
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
