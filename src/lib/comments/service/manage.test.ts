import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sweepStalePostFixtures } from "@/test/helpers";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { deleteComment, setPostCommentsLocked } = await import("./manage");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-manage-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;
const otherId = `user-${runId}-other`;
const adminId = `user-${runId}-admin`;

let categoryId: number;
let postId: string;

const AUTHOR = { id: authorId, role: "reader", bannedAt: null };
const OTHER = { id: otherId, role: "reader", bannedAt: null };
const ADMIN = { id: adminId, role: "admin", bannedAt: null };

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
      id: otherId,
      name: `Other ${runId}`,
      email: `other-${runId}@example.com`,
      role: "reader",
    },
    {
      id: adminId,
      name: `Admin ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
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
      authorId,
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
});

afterAll(async () => {
  await testDb.delete(comments).where(eq(comments.postId, postId));
  await testDb.delete(posts).where(eq(posts.id, postId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb
    .delete(user)
    .where(inArray(user.id, [authorId, otherId, adminId]));
  await pool.end();
});

async function insertComment(
  overrides: Partial<typeof comments.$inferInsert> = {},
) {
  const [row] = await testDb
    .insert(comments)
    .values({
      postId,
      authorId,
      parentId: null,
      body: "Body.",
      status: "visible",
      ...overrides,
    })
    .returning({ id: comments.id });
  return row!;
}

describe("deleteComment", () => {
  it("returns an error for an unknown comment id", async () => {
    const result = await deleteComment(
      "00000000-0000-4000-8000-000000000001",
      AUTHOR,
    );
    expect(result).toEqual({ ok: false, error: "Comment not found." });
  });

  it("rejects a non-owner, non-admin caller", async () => {
    const inserted = await insertComment();
    const result = await deleteComment(inserted.id, OTHER);
    expect(result).toEqual({ ok: false, error: "Not authorized." });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted.id));
    expect(row).toBeDefined(); // untouched
  });

  it("hard-deletes the owner's childless comment", async () => {
    const inserted = await insertComment();
    const result = await deleteComment(inserted.id, AUTHOR);
    expect(result).toEqual({ ok: true, data: { id: inserted.id } });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted.id));
    expect(row).toBeUndefined();
  });

  it("soft-deletes when the comment has children (placeholder, body cleared)", async () => {
    const parent = await insertComment({ body: "Parent." });
    await insertComment({
      parentId: parent.id,
      authorId: otherId,
      body: "Child.",
    });

    const result = await deleteComment(parent.id, AUTHOR);
    expect(result).toEqual({ ok: true, data: { id: parent.id } });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, parent.id));
    expect(row).toMatchObject({ status: "deleted", body: "" });
  });

  it("lets an admin delete another user's comment (ManageAnyComment bypass)", async () => {
    const inserted = await insertComment({
      authorId: otherId,
      body: "Someone else's.",
    });
    const result = await deleteComment(inserted.id, ADMIN);
    expect(result).toEqual({ ok: true, data: { id: inserted.id } });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted.id));
    expect(row).toBeUndefined();
  });
});

describe("setPostCommentsLocked", () => {
  it("locks and unlocks a post's comments", async () => {
    const locked = await setPostCommentsLocked(postId, true);
    expect(locked).toEqual({ ok: true, data: { postId, locked: true } });
    const [row1] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, postId));
    expect(row1!.commentsLocked).toBe(true);

    const unlocked = await setPostCommentsLocked(postId, false);
    expect(unlocked).toEqual({ ok: true, data: { postId, locked: false } });
    const [row2] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, postId));
    expect(row2!.commentsLocked).toBe(false);
  });

  it("returns an error for an unknown post", async () => {
    const result = await setPostCommentsLocked(
      "00000000-0000-4000-8000-000000000002",
      true,
    );
    expect(result).toEqual({ ok: false, error: "Post not found." });
  });
});
