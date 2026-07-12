import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sessionUser, sweepStalePostFixtures } from "@/test/helpers";

// vi.hoisted lifts this above the mock factories (TDZ otherwise) — one
// pool/db serves both the mocked "@/db" and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
  requireStaff: async () => {
    throw new Error("requireStaff is unmocked");
  },
}));

const { setCommentLike, setPostLike } = await import("./likes");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-likes-action-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const readerId = `user-${runId}-reader`;
const bannedReaderId = `user-${runId}-banned`;

let categoryId: number;
let postId: string;
let commentId: string;

function asReader() {
  sessionMock.current = sessionUser(readerId, "reader");
}
function asBannedReader() {
  sessionMock.current = sessionUser(bannedReaderId, "reader", new Date());
}
function noSession() {
  sessionMock.current = null;
}

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
      id: bannedReaderId,
      name: `Banned ${runId}`,
      email: `banned-${runId}@example.com`,
      role: "reader",
      bannedAt: new Date(),
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;

  const [post] = await testDb
    .insert(posts)
    .values({
      authorId: readerId,
      title: `Post ${runId}`,
      slug: `${runId}-post`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: posts.id });
  postId = post!.id;

  const [comment] = await testDb
    .insert(comments)
    .values({
      postId,
      authorId: readerId,
      parentId: null,
      body: "Nice game.",
      status: "visible",
    })
    .returning({ id: comments.id });
  commentId = comment!.id;
});

afterAll(async () => {
  await testDb.delete(comments).where(eq(comments.postId, postId));
  await testDb.delete(posts).where(eq(posts.id, postId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [readerId, bannedReaderId]));
  await pool.end();
});

describe("setPostLike", () => {
  it("errors without a session", async () => {
    noSession();
    const result = await setPostLike(postId, true);
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("errors on an invalid uuid before touching the service", async () => {
    asReader();
    const result = await setPostLike("not-a-uuid", true);
    expect(result.ok).toBe(false);
  });

  it("surfaces the typed banned message for a banned caller", async () => {
    asBannedReader();
    const result = await setPostLike(postId, true);
    expect(result).toEqual({
      ok: false,
      error: "You're banned from liking.",
    });
  });

  it("likes the post for a signed-in reader", async () => {
    asReader();
    const result = await setPostLike(postId, true);
    expect(result).toEqual({
      ok: true,
      data: { liked: true, likeCount: expect.any(Number) },
    });
  });
});

describe("setCommentLike", () => {
  it("errors without a session", async () => {
    noSession();
    const result = await setCommentLike(commentId, true);
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("errors on an invalid uuid before touching the service", async () => {
    asReader();
    const result = await setCommentLike("not-a-uuid", true);
    expect(result.ok).toBe(false);
  });

  it("surfaces the typed banned message for a banned caller", async () => {
    asBannedReader();
    const result = await setCommentLike(commentId, true);
    expect(result).toEqual({
      ok: false,
      error: "You're banned from liking.",
    });
  });

  it("likes the comment for a signed-in reader", async () => {
    asReader();
    const result = await setCommentLike(commentId, true);
    expect(result).toEqual({
      ok: true,
      data: { liked: true, likeCount: expect.any(Number) },
    });
  });
});
