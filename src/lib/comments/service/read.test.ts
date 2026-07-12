import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sweepStalePostFixtures } from "@/test/helpers";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { loadCommentThread } = await import("./read");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-read-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;

let categoryId: number;
let visiblePostId: string;
let draftPostId: string;

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });

  await testDb.insert(user).values({
    id: authorId,
    name: `Author ${runId}`,
    email: `author-${runId}@example.com`,
    role: "reader",
  });

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

  await testDb.insert(comments).values([
    {
      postId: visiblePostId,
      authorId,
      parentId: null,
      body: "Visible top-level.",
      status: "visible",
    },
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
  await testDb.delete(user).where(eq(user.id, authorId));
  await pool.end();
});

describe("loadCommentThread", () => {
  it("returns not-found for a missing or non-visible post", async () => {
    expect(await loadCommentThread(draftPostId)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      await loadCommentThread("00000000-0000-4000-8000-000000000001"),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns the meta.commentsLocked flag and the assembled tree", async () => {
    const result = await loadCommentThread(visiblePostId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thread.meta).toEqual({ commentsLocked: true });
    expect(result.thread.comments).toHaveLength(1);
    expect(result.thread.comments[0]).toMatchObject({
      body: "Visible top-level.",
      status: "visible",
    });
  });
});
