import "server-only";

// Pure DB access for the likes domain (post likes, comment likes) — queries/
// mutations only. Business rules (banned check, capability check, target
// visibility) live in src/lib/likes/service.ts.

import { and, count, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { comments, commentLikes, postLikes, posts } from "@/db/schema";
import { visiblePostsWhere } from "@/lib/posts/posts";
import { CommentStatus } from "@/lib/comments/status";

// Composite PK makes the insert naturally idempotent (design §5.4): a
// second like from the same user is a no-op, not a unique-violation error.
export async function insertPostLike(
  postId: string,
  userId: string,
): Promise<void> {
  await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
}

export async function deletePostLike(
  postId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));
}

export async function countPostLikes(postId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(postLikes)
    .where(eq(postLikes.postId, postId));
  return row?.value ?? 0;
}

export type PostLikeState = { likeCount: number; likedByMe: boolean };

// Read path for post-level like state (LIKE-3, design §5.4): "counts via
// COUNT(*) at read time", inlined in a tiny dynamic fetch for the post like
// button (GET /api/likes) rather than denormalized onto posts, mirroring how
// the comment tree read (src/lib/comments/data.ts) carries per-comment
// likeCount/likedByMe.
//
// null means the post isn't publicly visible right now (design D5-style
// visibility gate, matching loadPostForComment) — the route 404s on null
// rather than ever returning a like count for a draft/archived post.
export async function loadPostLikeState(
  postId: string,
  viewerId: string | null,
): Promise<PostLikeState | null> {
  // Signed-out reader: skip the EXISTS entirely via a `false` literal rather
  // than parameterizing a viewer id that can never match (same pattern as
  // loadCommentRowsForPost).
  const likedByMe = viewerId
    ? sql<boolean>`exists (select 1 from ${postLikes} where ${postLikes.postId} = ${posts.id} and ${postLikes.userId} = ${viewerId})`
    : sql<boolean>`false`;

  const [row] = await db
    .select({
      // `::int` keeps this a native pg int4 (parsed as a JS number), not the
      // string node-postgres would hand back for an int8/bigint COUNT(*).
      likeCount: sql<number>`(select count(*)::int from ${postLikes} where ${postLikes.postId} = ${posts.id})`,
      likedByMe,
    })
    .from(posts)
    .where(and(eq(posts.id, postId), visiblePostsWhere()))
    .limit(1);

  return row ?? null;
}

export async function insertCommentLike(
  commentId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(commentLikes)
    .values({ commentId, userId })
    .onConflictDoNothing();
}

export async function deleteCommentLike(
  commentId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(commentLikes)
    .where(
      and(
        eq(commentLikes.commentId, commentId),
        eq(commentLikes.userId, userId),
      ),
    );
}

export async function countCommentLikes(commentId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(commentLikes)
    .where(eq(commentLikes.commentId, commentId));
  return row?.value ?? 0;
}

// Reused (not duplicated — engineering rule) from the posts domain: a like
// can only land on a post that's publicly visible right now, mirroring
// loadPostForComment (src/lib/comments/data.ts).
export async function loadLikeablePost(
  postId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), visiblePostsWhere()))
    .limit(1);
  return row;
}

// A comment can only be liked while it's currently `visible` — held/
// rejected/deleted comments aren't rendered to like in the first place.
export async function loadLikeableComment(
  commentId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.status, CommentStatus.Visible),
      ),
    )
    .limit(1);
  return row;
}
