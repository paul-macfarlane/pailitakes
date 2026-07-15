import "server-only";

// Business logic for the admin-only user role/ban mutations (ADM-10,
// FR-4.8/10.2). The single invariant on role/ban changes is "never leave
// zero active admins" — which covers removing another admin AND the sole
// admin removing themselves (there is deliberately no separate self-block;
// the UI disables the self-row controls). DB access lives in
// src/lib/users/data.ts.

import { anonymizeCommentsForUser } from "@/lib/comments/data";
import { Role } from "@/lib/auth/roles";
import { userHasAuthoredPosts } from "@/lib/posts/data";
import { GENERIC_ERROR, type ActionResult } from "@/lib/shared/action-result";
import { wouldOrphanAdmins } from "@/lib/users/admin";
import {
  type TargetUserState,
  type Tx,
  updateUserBanned,
  updateUserRole,
  withLockedUserMutation,
} from "@/lib/users/data";

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
      target.role === Role.Admin && newRole !== Role.Admin,
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
    removesActiveAdmin: (target) => isBanning && target.role === Role.Admin,
    lastAdminError: "You can't ban the last admin.",
    apply: (tx) => updateUserBanned(tx, id, isBanning ? new Date() : null),
  });
}

// Refusal copy for prepareAccountDeletion (ACCT-1) — exported because these
// strings surface verbatim in the account-deletion dialog (Better Auth's
// beforeDelete hook throws an APIError carrying one of them, and the client
// displays whatever message the API returns).
export const ACCOUNT_HAS_POSTS_ERROR =
  "Your account has authored posts. Contact the site owner to transfer or delete them first.";
export const ACCOUNT_LAST_ADMIN_ERROR =
  "You're the last active admin. Promote another admin before deleting your account.";

// Self-service account deletion guard + anonymization (ACCT-1), called from
// Better Auth's user.deleteUser.beforeDelete hook (src/lib/auth/auth.ts).
// Banned users may delete their own account — only authored posts and the
// last-active-admin invariant block a delete; comments are anonymized
// in-place rather than blocking on them (design decision, see backlog).
export async function prepareAccountDeletion(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withLockedUserMutation(
      userId,
      async (tx, activeAdminIds, target) => {
        if (!target) {
          return { ok: false, error: "User not found." };
        }

        // Plain (non-tx) read: no existing flow reassigns a post's author,
        // so authorship can't change concurrently with an account deletion —
        // nothing here needs the row lock withLockedUserMutation already
        // holds on the target user.
        if (await userHasAuthoredPosts(userId)) {
          return { ok: false, error: ACCOUNT_HAS_POSTS_ERROR };
        }

        const isActiveAdmin =
          target.role === Role.Admin && target.bannedAt === null;
        if (isActiveAdmin && wouldOrphanAdmins(activeAdminIds, userId)) {
          return { ok: false, error: ACCOUNT_LAST_ADMIN_ERROR };
        }

        await anonymizeCommentsForUser(tx, userId);
        return { ok: true };
      },
    );
  } catch (err) {
    console.error("prepareAccountDeletion failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
