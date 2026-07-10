import "server-only";

// Business logic for the admin-only user role/ban mutations (ADM-10,
// FR-4.8/10.2). The single invariant on role/ban changes is "never leave
// zero active admins" — which covers removing another admin AND the sole
// admin removing themselves (there is deliberately no separate self-block;
// the UI disables the self-row controls). DB access lives in
// src/lib/users/data.ts.

import type { Role } from "@/lib/auth/roles";
import type { ActionResult } from "@/lib/shared/action-result";
import { wouldOrphanAdmins } from "@/lib/users/admin";
import {
  type TargetUserState,
  type Tx,
  updateUserBanned,
  updateUserRole,
  withLockedUserMutation,
} from "@/lib/users/data";

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Applies an admin-only change to one user under the last-admin invariant.
// Locks + reads the active-admin set and the target row (withLockedUserMutation),
// honors a no-op, and — when the change removes the target from the
// active-admin set — rejects it if that would leave zero admins. The caller
// (already admin-gated) supplies the change.
async function guardedUserMutation<T>(opts: {
  userId: string;
  data: T;
  isNoOp: (target: TargetUserState) => boolean;
  removesActiveAdmin: (target: TargetUserState) => boolean;
  lastAdminError: string;
  apply: (tx: Tx) => Promise<unknown>;
}): Promise<ActionResult<T>> {
  try {
    return await withLockedUserMutation(
      opts.userId,
      async (tx, activeAdminIds, target) => {
        if (!target) {
          return { ok: false, error: "User not found." };
        }
        if (opts.isNoOp(target)) {
          return { ok: true, data: opts.data };
        }
        if (
          opts.removesActiveAdmin(target) &&
          wouldOrphanAdmins(activeAdminIds, opts.userId)
        ) {
          return { ok: false, error: opts.lastAdminError };
        }

        await opts.apply(tx);
        return { ok: true, data: opts.data };
      },
    );
  } catch (err) {
    console.error("guardedUserMutation failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setUserRoleService(
  id: string,
  newRole: Role,
): Promise<ActionResult<{ id: string; role: Role }>> {
  return guardedUserMutation({
    userId: id,
    data: { id, role: newRole },
    isNoOp: (target) => target.role === newRole,
    removesActiveAdmin: (target) =>
      target.role === "admin" && newRole !== "admin",
    lastAdminError: "You can't remove the last admin.",
    apply: (tx) => updateUserRole(tx, id, newRole),
  });
}

export async function setUserBannedService(
  id: string,
  isBanning: boolean,
): Promise<ActionResult<{ id: string; banned: boolean }>> {
  return guardedUserMutation({
    userId: id,
    data: { id, banned: isBanning },
    isNoOp: (target) =>
      isBanning ? target.bannedAt !== null : target.bannedAt === null,
    // Banning removes the user from the active-admin set, so it faces the same
    // guard as demotion; unbanning never removes an admin.
    removesActiveAdmin: (target) => isBanning && target.role === "admin",
    lastAdminError: "You can't ban the last admin.",
    apply: (tx) => updateUserBanned(tx, id, isBanning ? new Date() : null),
  });
}
