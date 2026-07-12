import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { CommentStatus } from "@/lib/comments/status";
import { sweepStalePostFixtures } from "@/test/helpers";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { loadCommentThread } = await import("./read");

const { categories, commentLikes, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-read-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;
const likerId = `user-${runId}-liker`;

let categoryId: number;
let visiblePostId: string;
let draftPostId: string;
let likedCommentId: string;
let heldCommentId: string;

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });

  await testDb.insert(user).values([
    {
      id: authorId,
      name: `Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "reader",
    },
    {
      id: likerId,
      name: `Liker ${runId}`,
      email: `liker-${runId}@example.com`,
      role: "reader",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;

  const [visiblePost] = await testDb
    .insert(posts)
    .values({
      authorId,
      title: `Post ${runId} visible`,
      slug: `${runId}-visible`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(Date.now() - 60_000),
      commentsLocked: true,
    })
    .returning({ id: posts.id });
  visiblePostId = visiblePost!.id;

  const [draftPost] = await testDb
    .insert(posts)
    .values({
      authorId,
      title: `Post ${runId} draft`,
      slug: `${runId}-draft`,
      bodyMd: "Body.",
      thumbnailUrl: "",
      categoryId,
      status: "draft",
    })
    .returning({ id: posts.id });
  draftPostId = draftPost!.id;

  const [likedComment] = await testDb
    .insert(comments)
    .values({
      postId: visiblePostId,
      authorId,
      parentId: null,
      body: "Visible top-level.",
      status: "visible",
    })
    .returning({ id: comments.id });
  likedCommentId = likedComment!.id;

  // held (redacted) parent with a visible child so buildCommentTree keeps it
  // as a placeholder — its like fields must still zero out on read even
  // though the row itself carries a like (design: a redacted node renders no
  // like button).
  const [heldComment] = await testDb
    .insert(comments)
    .values({
      postId: visiblePostId,
      authorId,
      parentId: null,
      body: "Held parent.",
      status: "held",
    })
    .returning({ id: comments.id });
  heldCommentId = heldComment!.id;
  await testDb.insert(comments).values({
    postId: visiblePostId,
    authorId,
    parentId: heldCommentId,
    body: "Visible reply to held parent.",
    status: "visible",
  });

  await testDb.insert(commentLikes).values([
    { commentId: likedCommentId, userId: likerId },
    { commentId: heldCommentId, userId: likerId },
  ]);
});

afterAll(async () => {
  await testDb
    .delete(comments)
    .where(inArray(comments.postId, [visiblePostId, draftPostId]));
  await testDb
    .delete(posts)
    .where(inArray(posts.id, [visiblePostId, draftPostId]));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [authorId, likerId]));
  await pool.end();
});

describe("loadCommentThread", () => {
  it("returns not-found for a missing or non-visible post", async () => {
    expect(await loadCommentThread(draftPostId, null)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      await loadCommentThread("00000000-0000-4000-8000-000000000001", null),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns the meta.commentsLocked flag and the assembled tree", async () => {
    const result = await loadCommentThread(visiblePostId, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thread.meta).toEqual({ commentsLocked: true });
    const top = result.thread.comments.find((c) => c.id === likedCommentId);
    expect(top).toMatchObject({
      body: "Visible top-level.",
      status: "visible",
    });
  });

  it("threads viewerId through so likeCount/likedByMe reflect the given viewer", async () => {
    const asLiker = await loadCommentThread(visiblePostId, likerId);
    expect(asLiker.ok).toBe(true);
    if (!asLiker.ok) return;
    const likedAsLiker = asLiker.thread.comments.find(
      (c) => c.id === likedCommentId,
    );
    expect(likedAsLiker).toMatchObject({ likeCount: 1, likedByMe: true });

    const asSignedOut = await loadCommentThread(visiblePostId, null);
    expect(asSignedOut.ok).toBe(true);
    if (!asSignedOut.ok) return;
    const likedAsSignedOut = asSignedOut.thread.comments.find(
      (c) => c.id === likedCommentId,
    );
    expect(likedAsSignedOut).toMatchObject({ likeCount: 1, likedByMe: false });
  });

  it("zeroes likeCount/likedByMe on a redacted held placeholder even though its row has a like", async () => {
    const result = await loadCommentThread(visiblePostId, likerId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heldPlaceholder = result.thread.comments.find(
      (c) => c.id === heldCommentId,
    );
    expect(heldPlaceholder).toMatchObject({
      status: CommentStatus.Held,
      body: "",
      likeCount: 0,
      likedByMe: false,
    });
  });
});
