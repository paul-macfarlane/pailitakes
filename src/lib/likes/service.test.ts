import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sweepStalePostFixtures } from "@/test/helpers";

// vi.hoisted lifts this above the mock factories (TDZ otherwise) — one
// pool/db serves both the mocked "@/db" and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { getPostLikeState, setCommentLike, setPostLike, BANNED_LIKE_MESSAGE } =
  await import("./service");

const { categories, comments, commentLikes, postLikes, posts, user } = schema;

const SEED_PREFIX = "t-likes-svc-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const readerId = `user-${runId}-reader`;
const otherReaderId = `user-${runId}-other`;

let categoryId: number;
let visiblePostId: string;
let draftPostId: string;
let visibleCommentId: string;
let rejectedCommentId: string;

const READER = { id: readerId, role: "reader", bannedAt: null as Date | null };
const OTHER_READER = {
  id: otherReaderId,
  role: "reader",
  bannedAt: null as Date | null,
};

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });

  await testDb.insert(user).values([
    {
      id: readerId,
      name: `Reader ${runId}`,
      email: `reader-${runId}@example.com`,
      role: "reader",
    },
    {
      id: otherReaderId,
      name: `Other ${runId}`,
      email: `other-${runId}@example.com`,
      role: "reader",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;

  const now = new Date();

  const [visiblePost] = await testDb
    .insert(posts)
    .values({
      authorId: readerId,
      title: `Post ${runId} visible`,
      slug: `${runId}-visible`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(now.getTime() - 60_000),
    })
    .returning({ id: posts.id });
  visiblePostId = visiblePost!.id;

  const [draftPost] = await testDb
    .insert(posts)
    .values({
      authorId: readerId,
      title: `Post ${runId} draft`,
      slug: `${runId}-draft`,
      bodyMd: "Body.",
      thumbnailUrl: "",
      categoryId,
      status: "draft",
    })
    .returning({ id: posts.id });
  draftPostId = draftPost!.id;

  const [visibleComment] = await testDb
    .insert(comments)
    .values({
      postId: visiblePostId,
      authorId: readerId,
      parentId: null,
      body: "Visible comment.",
      status: "visible",
    })
    .returning({ id: comments.id });
  visibleCommentId = visibleComment!.id;

  const [rejectedComment] = await testDb
    .insert(comments)
    .values({
      postId: visiblePostId,
      authorId: readerId,
      parentId: null,
      body: "Rejected comment.",
      status: "rejected",
    })
    .returning({ id: comments.id });
  rejectedCommentId = rejectedComment!.id;
});

afterAll(async () => {
  await testDb
    .delete(comments)
    .where(inArray(comments.postId, [visiblePostId, draftPostId]));
  await testDb
    .delete(posts)
    .where(inArray(posts.id, [visiblePostId, draftPostId]));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [readerId, otherReaderId]));
  await pool.end();
});

async function clearPostLikes(postId: string) {
  await testDb.delete(postLikes).where(eq(postLikes.postId, postId));
}
async function clearCommentLikes(commentId: string) {
  await testDb
    .delete(commentLikes)
    .where(eq(commentLikes.commentId, commentId));
}

describe("setPostLike", () => {
  it("denies a banned caller with BANNED_LIKE_MESSAGE, without touching the row", async () => {
    await clearPostLikes(visiblePostId);
    const result = await setPostLike(visiblePostId, true, {
      ...READER,
      bannedAt: new Date(),
    });
    expect(result).toEqual({ ok: false, error: BANNED_LIKE_MESSAGE });
    const [row] = await testDb
      .select()
      .from(postLikes)
      .where(eq(postLikes.postId, visiblePostId));
    expect(row).toBeUndefined();
  });

  it("errors (defense in depth) for a caller whose role has no LikeContent grant", async () => {
    const result = await setPostLike(visiblePostId, true, {
      ...READER,
      role: "not-a-real-role",
    });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects liking a post that isn't publicly visible (draft)", async () => {
    const result = await setPostLike(draftPostId, true, READER);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects liking a post that doesn't exist", async () => {
    const result = await setPostLike(
      "00000000-0000-4000-8000-000000000099",
      true,
      READER,
    );
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("is idempotent: liking twice still yields exactly one row and likeCount 1", async () => {
    await clearPostLikes(visiblePostId);
    await setPostLike(visiblePostId, true, READER);
    const result = await setPostLike(visiblePostId, true, READER);

    expect(result).toEqual({ ok: true, data: { liked: true, likeCount: 1 } });
    const rows = await testDb
      .select()
      .from(postLikes)
      .where(eq(postLikes.postId, visiblePostId));
    expect(rows).toHaveLength(1);
  });

  it("unliking when no row exists is a no-op ok result, count unchanged", async () => {
    await clearPostLikes(visiblePostId);
    const result = await setPostLike(visiblePostId, false, READER);
    expect(result).toEqual({ ok: true, data: { liked: false, likeCount: 0 } });
  });

  it("like then unlike returns the count to baseline", async () => {
    await clearPostLikes(visiblePostId);
    await setPostLike(visiblePostId, true, READER);
    const result = await setPostLike(visiblePostId, false, READER);
    expect(result).toEqual({ ok: true, data: { liked: false, likeCount: 0 } });
  });

  it("count reflects multiple distinct users", async () => {
    await clearPostLikes(visiblePostId);
    await setPostLike(visiblePostId, true, READER);
    const result = await setPostLike(visiblePostId, true, OTHER_READER);
    expect(result).toEqual({ ok: true, data: { liked: true, likeCount: 2 } });
  });
});

describe("getPostLikeState", () => {
  it("returns the count and likedByMe=true for the liking viewer on a visible post", async () => {
    await clearPostLikes(visiblePostId);
    await setPostLike(visiblePostId, true, READER);

    expect(await getPostLikeState(visiblePostId, readerId)).toEqual({
      likeCount: 1,
      likedByMe: true,
    });
  });

  it("returns likedByMe=false for a different viewer, same count", async () => {
    expect(await getPostLikeState(visiblePostId, otherReaderId)).toEqual({
      likeCount: 1,
      likedByMe: false,
    });
  });

  it("returns likedByMe=false for a signed-out viewer (null), same count", async () => {
    expect(await getPostLikeState(visiblePostId, null)).toEqual({
      likeCount: 1,
      likedByMe: false,
    });
  });

  it("returns null for a non-visible post (draft), even with a like row present", async () => {
    // Seeded directly (not via setPostLike, which itself rejects liking a
    // draft) to prove the read's visibility gate, not the write path's.
    await clearPostLikes(draftPostId);
    await testDb.insert(postLikes).values({
      postId: draftPostId,
      userId: readerId,
    });

    expect(await getPostLikeState(draftPostId, readerId)).toBeNull();
  });

  it("returns null for an unknown post id", async () => {
    expect(
      await getPostLikeState("00000000-0000-4000-8000-000000000000", null),
    ).toBeNull();
  });
});

describe("setCommentLike", () => {
  it("denies a banned caller with BANNED_LIKE_MESSAGE, without touching the row", async () => {
    await clearCommentLikes(visibleCommentId);
    const result = await setCommentLike(visibleCommentId, true, {
      ...READER,
      bannedAt: new Date(),
    });
    expect(result).toEqual({ ok: false, error: BANNED_LIKE_MESSAGE });
    const [row] = await testDb
      .select()
      .from(commentLikes)
      .where(eq(commentLikes.commentId, visibleCommentId));
    expect(row).toBeUndefined();
  });

  it("errors (defense in depth) for a caller whose role has no LikeContent grant", async () => {
    const result = await setCommentLike(visibleCommentId, true, {
      ...READER,
      role: "not-a-real-role",
    });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects liking a comment that isn't visible (rejected)", async () => {
    const result = await setCommentLike(rejectedCommentId, true, READER);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects liking a comment that doesn't exist", async () => {
    const result = await setCommentLike(
      "00000000-0000-4000-8000-000000000099",
      true,
      READER,
    );
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("is idempotent: liking twice still yields exactly one row and likeCount 1", async () => {
    await clearCommentLikes(visibleCommentId);
    await setCommentLike(visibleCommentId, true, READER);
    const result = await setCommentLike(visibleCommentId, true, READER);

    expect(result).toEqual({ ok: true, data: { liked: true, likeCount: 1 } });
    const rows = await testDb
      .select()
      .from(commentLikes)
      .where(eq(commentLikes.commentId, visibleCommentId));
    expect(rows).toHaveLength(1);
  });

  it("unliking when no row exists is a no-op ok result, count unchanged", async () => {
    await clearCommentLikes(visibleCommentId);
    const result = await setCommentLike(visibleCommentId, false, READER);
    expect(result).toEqual({ ok: true, data: { liked: false, likeCount: 0 } });
  });

  it("like then unlike returns the count to baseline", async () => {
    await clearCommentLikes(visibleCommentId);
    await setCommentLike(visibleCommentId, true, READER);
    const result = await setCommentLike(visibleCommentId, false, READER);
    expect(result).toEqual({ ok: true, data: { liked: false, likeCount: 0 } });
  });

  it("count reflects multiple distinct users", async () => {
    await clearCommentLikes(visibleCommentId);
    await setCommentLike(visibleCommentId, true, READER);
    const result = await setCommentLike(visibleCommentId, true, OTHER_READER);
    expect(result).toEqual({ ok: true, data: { liked: true, likeCount: 2 } });
  });
});
