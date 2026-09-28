import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { postCollaborators, posts, user } from "@/db/schema";
import { Action, rolesWithAction } from "@/lib/auth/permissions";
import {
  lockPostRow,
  type ExistingPostForUpdate,
  type Tx,
} from "@/lib/posts/data";
import type { CollaboratorRole } from "./permissions";

export async function membershipFor(
  postId: string,
  userId: string,
  tx?: Tx,
): Promise<CollaboratorRole | null> {
  const [row] = await (tx ?? db)
    .select({ role: postCollaborators.role })
    .from(postCollaborators)
    .where(
      and(
        eq(postCollaborators.postId, postId),
        eq(postCollaborators.userId, userId),
      ),
    );
  return row?.role ?? null;
}

// Membership changes serialize with saves, lifecycle transitions and review
// decisions on the same parent post lock.
export async function withLockedMembership<T>(
  postId: string,
  run: (tx: Tx, post: ExistingPostForUpdate) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const post = await lockPostRow(tx, postId);
    return post ? run(tx, post) : null;
  });
}

export async function changeMembership(
  tx: Tx,
  postId: string,
  userId: string,
  role: CollaboratorRole | null,
  rotateEditVersion: boolean,
): Promise<void> {
  if (role === null) {
    await tx
      .delete(postCollaborators)
      .where(
        and(
          eq(postCollaborators.postId, postId),
          eq(postCollaborators.userId, userId),
        ),
      );
  } else {
    await tx
      .insert(postCollaborators)
      .values({ postId, userId, role })
      .onConflictDoUpdate({
        target: [postCollaborators.postId, postCollaborators.userId],
        set: { role },
      });
  }
  if (rotateEditVersion) {
    await tx
      .update(posts)
      .set({ editVersion: crypto.randomUUID() })
      .where(eq(posts.id, postId));
  }
}

// Admins already manage every post, so a membership would only add noise to
// their Shared with me list.
const collaboratorRoles = rolesWithAction(Action.CreatePost).filter(
  (role) => !rolesWithAction(Action.ManageAnyPost).includes(role),
);
const activeAuthorWhere = and(
  inArray(user.role, collaboratorRoles),
  isNull(user.bannedAt),
);

// FOR SHARE holds the target's role/ban steady until the grant commits.
export async function isActiveAuthor(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, id), activeAuthorWhere))
    .for("share");
  return row !== undefined;
}

export async function postForSharing(postId: string) {
  const [row] = await db
    .select({ title: posts.title, authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId));
  return row;
}

export async function collaboratorOptions(authorId: string) {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(ne(user.id, authorId), activeAuthorWhere))
    .orderBy(asc(user.name), asc(user.id));
}

export async function collaboratorsFor(postId: string) {
  return db
    .select({
      userId: user.id,
      name: user.name,
      role: postCollaborators.role,
    })
    .from(postCollaborators)
    .innerJoin(user, eq(user.id, postCollaborators.userId))
    .where(eq(postCollaborators.postId, postId))
    .orderBy(asc(user.name), asc(user.id));
}

export async function sharedPostsFor(userId: string) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      updatedAt: posts.updatedAt,
      role: postCollaborators.role,
      authorName: user.name,
    })
    .from(postCollaborators)
    .innerJoin(posts, eq(posts.id, postCollaborators.postId))
    .innerJoin(user, eq(user.id, posts.authorId))
    .where(
      and(eq(postCollaborators.userId, userId), ne(posts.authorId, userId)),
    )
    .orderBy(desc(posts.updatedAt), desc(posts.id));
}
