import "server-only";

// Business logic for the admin-only user role/ban mutations (ADM-10,
// FR-4.8/10.2). The single invariant on role/ban changes is "never leave
// zero active admins" — which covers removing another admin AND the sole
// admin removing themselves (there is deliberately no separate self-block;
// the UI disables the self-row controls). DB access lives in
// src/lib/users/data.ts.

import { revalidateTag } from "next/cache";

import { Action, canPerformAction } from "@/lib/auth/permissions";
import { Role } from "@/lib/auth/roles";
import { anonymizeCommentsForUser } from "@/lib/comments/data";
import {
  deleteNeverPublicPostsForUser,
  transferPostsOwnership,
} from "@/lib/posts/data";
import { GENERIC_ERROR, type ActionResult } from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";
import { wouldOrphanAdmins } from "@/lib/users/admin";
import {
  loadUserState,
  type TargetUserState,
  type Tx,
  updateUserBanned,
  updateUserRole,
  userHasAuthoredPostsTx,
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

// Refusal copy for transferUserPostsService, surfaced verbatim by the
// admin users screen's "Transfer posts" control.
export const TRANSFER_SAME_USER_ERROR =
  "Choose a different staff member to transfer posts to.";
export const TRANSFER_TARGET_INVALID_ERROR =
  "Posts can only be transferred to an active staff member.";

// Admin-only bulk post reassignment (ACCT-1 follow-up): moves every post
// authored by `fromUserId` to `toUserId`, both for the users screen's
// standalone "Transfer posts" control and as the escape hatch
// prepareAccountDeletion's refusal (below) points admins at for a departing
// author's ever-public/commented posts. Single UPDATE
// (transferPostsOwnership) — no lock/transaction: the accepted race is a
// concurrent role change or ban on the target between the read below and the
// write, which could leave posts owned by someone who no longer has
// AccessAdmin; that's self-correcting (re-run the transfer) and not worth a
// row lock for an admin-only, low-frequency action.
export async function transferUserPostsService(
  fromUserId: string,
  toUserId: string,
): Promise<ActionResult<{ transferred: number }>> {
  if (fromUserId === toUserId) {
    return { ok: false, error: TRANSFER_SAME_USER_ERROR };
  }

  try {
    const target = await loadUserState(toUserId);
    if (!target || !canPerformAction(target, Action.AccessAdmin)) {
      return { ok: false, error: TRANSFER_TARGET_INVALID_ERROR };
    }

    const affected = await transferPostsOwnership(fromUserId, toUserId);
    if (affected.length > 0) {
      // Public post pages render "By {author name}", so every affected
      // slug's cache must be busted, plus post-list (author shows up in
      // list/preview cards too).
      revalidateTag("post-list", IMMEDIATE);
      for (const { slug } of affected) {
        revalidateTag(`post:${slug}`, IMMEDIATE);
      }
    }

    return { ok: true, data: { transferred: affected.length } };
  } catch (err) {
    console.error("transferUserPostsService failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Refusal copy for prepareAccountDeletion (ACCT-1) — exported because these
// strings surface verbatim in the account-deletion dialog (Better Auth's
// beforeDelete hook throws an APIError carrying one of them, and the client
// displays whatever message the API returns).
export const ACCOUNT_HAS_POSTS_ERROR =
  "Your account has published posts or posts with comments. Contact the site owner to transfer or delete them first.";
export const ACCOUNT_LAST_ADMIN_ERROR =
  "You're the last active admin. Promote another admin before deleting your account.";

// Self-service account deletion guard + anonymization (ACCT-1), called from
// Better Auth's user.deleteUser.beforeDelete hook (src/lib/auth/auth.ts).
// Banned users may delete their own account — only surviving posts (see
// below) and the last-active-admin invariant block a delete; comments are
// anonymized in-place rather than blocking on them (design decision, see
// backlog).
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

        // Purge never-public, comment-free posts first (tx-composed, same
        // predicate as the author's own hard-delete) so the refusal below
        // only blocks on what actually survives — a draft-only author must
        // be able to delete their account outright. No cache revalidation
        // for this purge: a never-public post was never visible, so it was
        // never cached under any tag.
        await deleteNeverPublicPostsForUser(tx, userId);

        // Tx-scoped read (userHasAuthoredPostsTx, users/data.ts) rather than
        // posts/data.ts's plain userHasAuthoredPosts: the purge above ran on
        // this same `tx` and hasn't committed, so a plain `db.select` (a
        // fresh session) would still see the pre-purge rows under READ
        // COMMITTED — this check must run on `tx` to observe its own
        // transaction's uncommitted delete. Whatever survives the purge
        // (an ever-public post, or a never-public one with a real comment
        // thread) still blocks the delete; there's no flow that reassigns a
        // post's author concurrently with this transaction (the admin
        // transfer flow above is a plain UPDATE with no lock on this row),
        // and posts.authorId's FK stays RESTRICT (no onDelete, schema.ts) as
        // the backstop — a post transferred to this user mid-deletion (the
        // race that lock doesn't cover) makes the user-row delete below fail
        // loudly instead of silently orphaning it.
        if (await userHasAuthoredPostsTx(tx, userId)) {
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
