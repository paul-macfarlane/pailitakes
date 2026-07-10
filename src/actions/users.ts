"use server";

// Admin-only user management (ADM-10, FR-4.8/10.2). Server actions are the
// security boundary: every call re-checks admin, and the single invariant on
// role/ban changes is "never leave zero active admins" — which covers removing
// another admin AND the sole admin removing themselves (there is deliberately
// no separate self-block; the UI disables the self-row controls).

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { ActionResult } from "@/actions/posts";
import { db, type Db } from "@/db";
import { user, userRole } from "@/db/schema";
import { wouldOrphanAdmins } from "@/lib/users/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";

const GENERIC_ERROR = "Something went wrong. Please try again.";

const userIdSchema = z.string().min(1);
const roleSchema = z.enum(userRole.enumValues);

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TargetState = { role: string; bannedAt: Date | null };

async function adminSession() {
  const session = await getSession();
  return session && isAdmin(session.user) ? session : null;
}

// Applies an admin-only change to one user under the last-admin invariant.
// LOCKS THE ACTIVE-ADMIN SET FIRST (stable id order) on every call: this
// serializes all role/ban mutations, so the target's role can't change
// between our read and write (closing the unlocked-read race) and concurrent
// removals can't both pass the guard. Then locks + reads the target, honors a
// no-op, and — when the change removes the target from the active-admin set —
// rejects it if that would leave zero admins. The caller (already admin-gated)
// supplies the change.
async function guardedUserMutation<T>(opts: {
  userId: string;
  data: T;
  isNoOp: (target: TargetState) => boolean;
  removesActiveAdmin: (target: TargetState) => boolean;
  lastAdminError: string;
  apply: (tx: Tx) => Promise<unknown>;
}): Promise<ActionResult<T>> {
  try {
    return await db.transaction(async (tx) => {
      const activeAdminIds = (
        await tx
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.role, "admin"), isNull(user.bannedAt)))
          .orderBy(user.id)
          .for("update")
      ).map((row) => row.id);

      const [target] = await tx
        .select({ role: user.role, bannedAt: user.bannedAt })
        .from(user)
        .where(eq(user.id, opts.userId))
        .limit(1)
        .for("update");
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
    });
  } catch (err) {
    console.error("guardedUserMutation failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setUserRole(
  userId: unknown,
  role: unknown,
): Promise<ActionResult<{ id: string; role: string }>> {
  if (!(await adminSession())) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Invalid user." };
  }
  const roleResult = roleSchema.safeParse(role);
  if (!roleResult.success) {
    return { ok: false, error: "Invalid role." };
  }
  const id = idResult.data;
  const newRole = roleResult.data;

  return guardedUserMutation({
    userId: id,
    data: { id, role: newRole },
    isNoOp: (target) => target.role === newRole,
    removesActiveAdmin: (target) =>
      target.role === "admin" && newRole !== "admin",
    lastAdminError: "You can't remove the last admin.",
    apply: async (tx) => {
      await tx.update(user).set({ role: newRole }).where(eq(user.id, id));
    },
  });
}

export async function setUserBanned(
  userId: unknown,
  banned: unknown,
): Promise<ActionResult<{ id: string; banned: boolean }>> {
  if (!(await adminSession())) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Invalid user." };
  }
  const bannedResult = z.boolean().safeParse(banned);
  if (!bannedResult.success) {
    return { ok: false, error: "Invalid request." };
  }
  const id = idResult.data;
  const isBanning = bannedResult.data;

  return guardedUserMutation({
    userId: id,
    data: { id, banned: isBanning },
    isNoOp: (target) =>
      isBanning ? target.bannedAt !== null : target.bannedAt === null,
    // Banning removes the user from the active-admin set, so it faces the same
    // guard as demotion; unbanning never removes an admin.
    removesActiveAdmin: (target) => isBanning && target.role === "admin",
    lastAdminError: "You can't ban the last admin.",
    apply: async (tx) => {
      await tx
        .update(user)
        .set({ bannedAt: isBanning ? new Date() : null })
        .where(eq(user.id, id));
    },
  });
}
