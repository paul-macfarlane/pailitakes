import "server-only";

// Pure DB access for the admin-only user role/ban mutations (ADM-10,
// FR-4.8/10.2). Business rules (no-op detection, the last-admin invariant)
// live in src/lib/users/service.ts.

import { and, eq, isNull } from "drizzle-orm";

import { db, type Db } from "@/db";
import { posts, user } from "@/db/schema";
import { Role } from "@/lib/auth/roles";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TargetUserState = { role: Role; bannedAt: Date | null };

// Runs `fn` inside a transaction that first locks the active-admin set
// (stable id order) then locks + reads the target user row.
// LOCKS THE ACTIVE-ADMIN SET FIRST on every call: this serializes all
// role/ban mutations, so the target's role can't change between the read and
// the write (closing the unlocked-read race) and concurrent removals can't
// both pass the guard.
export async function withLockedUserMutation<T>(
  userId: string,
  fn: (
    tx: Tx,
    activeAdminIds: string[],
    target: TargetUserState | undefined,
  ) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const activeAdminIds = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, Role.Admin), isNull(user.bannedAt)))
        .orderBy(user.id)
        .for("update")
    ).map((row) => row.id);

    const [target] = await tx
      .select({ role: user.role, bannedAt: user.bannedAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update");

    return fn(tx, activeAdminIds, target);
  });
}

// Plain (non-tx) target-user read for flows that don't need the full
// active-admin lock withLockedUserMutation takes — e.g.
// transferUserPostsService (src/lib/users/service.ts), which is a single
// UPDATE with no transaction. Shares TargetUserState's shape with the locked
// read above so callers can reuse the same role/bannedAt checks either way.
export async function loadUserState(
  id: string,
): Promise<TargetUserState | undefined> {
  const [row] = await db
    .select({ role: user.role, bannedAt: user.bannedAt })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  return row;
}

// Tx-scoped mirror of posts/data.ts's userHasAuthoredPosts, needed only
// inside prepareAccountDeletion's transaction (service.ts): that flow first
// purges the user's never-public posts (deleteNeverPublicPostsForUser, same
// tx) and then must see the effect of that delete before deciding whether
// any posts remain — a plain `db.select` opens a fresh session and, under
// READ COMMITTED, would still see the pre-purge rows because the delete
// hasn't committed yet. This belongs conceptually beside userHasAuthoredPosts
// in posts/data.ts (same predicate, tx-aware sibling); it's implemented here
// instead purely because this task's diff is scoped to the users domain —
// cross-domain direct reads of another domain's table already exist at this
// layer (posts/admin.ts reads the `user` table the same way).
export async function userHasAuthoredPostsTx(
  tx: Tx,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.authorId, userId))
    .limit(1);
  return row !== undefined;
}

export async function updateUserRole(
  tx: Tx,
  id: string,
  role: Role,
): Promise<void> {
  await tx.update(user).set({ role }).where(eq(user.id, id));
}

export async function updateUserBanned(
  tx: Tx,
  id: string,
  bannedAt: Date | null,
): Promise<void> {
  await tx.update(user).set({ bannedAt }).where(eq(user.id, id));
}
