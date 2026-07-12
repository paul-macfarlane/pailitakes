import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

const moderateCommentMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/comments/moderation", () => ({
  moderateComment: moderateCommentMock,
}));

// env.ts parses process.env at import time and isn't populated with real
// values under an isolated vitest run (same reason the cron route test
// mocks it). Rate-limit boundaries are exhaustively covered in
// src/lib/comments/service/create.test.ts — this file only needs wiring, so
// the limits are set generously high to not interfere with the several
// comments the cases below create for the same reader.
vi.mock("@/lib/shared/env", () => ({
  env: {
    COMMENT_RATE_LIMIT_PER_MINUTE: 1000,
    COMMENT_RATE_LIMIT_PER_HOUR: 1000,
  },
}));

const {
  approveHeldComment,
  createComment,
  deleteComment,
  editComment,
  restoreRejectedComment,
  setCommentsLocked,
} = await import("./comments");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-action-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const readerId = `user-${runId}-reader`;
const otherReaderId = `user-${runId}-other`;
const adminId = `user-${runId}-admin`;

let categoryId: number;
let postId: string;

function asReader() {
  sessionMock.current = sessionUser(readerId, "reader");
}
function asOtherReader() {
  sessionMock.current = sessionUser(otherReaderId, "reader");
}
function asAdmin() {
  sessionMock.current = sessionUser(adminId, "admin");
}
function noSession() {
  sessionMock.current = null;
}

const ALLOW = {
  outcome: "allow" as const,
  reason: "clean",
  record: {
    verdict: "allow" as const,
    reason: "clean",
    model: "m",
    latencyMs: 1,
  },
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
      authorId: adminId,
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
    .where(inArray(user.id, [readerId, otherReaderId, adminId]));
  await pool.end();
});

beforeEach(() => {
  moderateCommentMock.mockReset().mockResolvedValue(ALLOW);
});

describe("createComment", () => {
  it("errors without a session", async () => {
    noSession();
    const result = await createComment({ postId, parentId: null, body: "Hi." });
    expect(result).toEqual({ status: "error", message: "Not authorized." });
  });

  it("errors on invalid input before touching the service", async () => {
    asReader();
    const result = await createComment({
      postId: "not-a-uuid",
      parentId: null,
      body: "Hi.",
    });
    expect(result.status).toBe("error");
    expect(moderateCommentMock).not.toHaveBeenCalled();
  });

  it("creates a visible comment for a signed-in reader", async () => {
    asReader();
    const result = await createComment({
      postId,
      parentId: null,
      body: "Nice win!",
    });
    expect(result.status).toBe("visible");
  });
});

describe("editComment", () => {
  it("errors without a session", async () => {
    noSession();
    const result = await editComment("00000000-0000-4000-8000-000000000001", {
      body: "x",
    });
    expect(result).toEqual({ status: "error", message: "Not authorized." });
  });

  it("edits the caller's own visible comment", async () => {
    asReader();
    const created = await createComment({
      postId,
      parentId: null,
      body: "Original.",
    });
    if (created.status !== "visible") throw new Error("setup failed");

    const result = await editComment(created.comment.id, { body: "Updated." });
    expect(result.status).toBe("visible");
    if (result.status !== "visible") return;
    expect(result.comment.body).toBe("Updated.");
  });
});

describe("deleteComment", () => {
  it("rejects a non-owner reader", async () => {
    asReader();
    const created = await createComment({
      postId,
      parentId: null,
      body: "Mine.",
    });
    if (created.status !== "visible") throw new Error("setup failed");

    asOtherReader();
    const result = await deleteComment(created.comment.id);
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("lets the owner delete their own comment", async () => {
    asReader();
    const created = await createComment({
      postId,
      parentId: null,
      body: "Delete me.",
    });
    if (created.status !== "visible") throw new Error("setup failed");

    const result = await deleteComment(created.comment.id);
    expect(result).toEqual({ ok: true, data: { id: created.comment.id } });
  });

  it("lets an admin delete someone else's comment", async () => {
    asReader();
    const created = await createComment({
      postId,
      parentId: null,
      body: "Admin will delete.",
    });
    if (created.status !== "visible") throw new Error("setup failed");

    asAdmin();
    const result = await deleteComment(created.comment.id);
    expect(result).toEqual({ ok: true, data: { id: created.comment.id } });
  });
});

describe("setCommentsLocked", () => {
  it("rejects a non-admin caller", async () => {
    asReader();
    const result = await setCommentsLocked(postId, true);
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("locks comments as admin", async () => {
    asAdmin();
    const result = await setCommentsLocked(postId, true);
    expect(result).toEqual({ ok: true, data: { postId, locked: true } });

    const [row] = await testDb.select().from(posts).where(eq(posts.id, postId));
    expect(row!.commentsLocked).toBe(true);

    await setCommentsLocked(postId, false);
  });
});

describe("approveHeldComment / restoreRejectedComment", () => {
  it("rejects a non-admin caller for both", async () => {
    asReader();
    expect(
      await approveHeldComment("00000000-0000-4000-8000-000000000001"),
    ).toEqual({ ok: false, error: "Not authorized." });
    expect(
      await restoreRejectedComment("00000000-0000-4000-8000-000000000001"),
    ).toEqual({ ok: false, error: "Not authorized." });
  });

  it("approves a held comment as admin", async () => {
    const [held] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: readerId,
        parentId: null,
        body: "Held.",
        status: "held",
      })
      .returning({ id: comments.id });

    asAdmin();
    const result = await approveHeldComment(held!.id);
    expect(result).toEqual({ ok: true, data: { id: held!.id } });
  });

  it("restores a rejected comment as admin", async () => {
    const [rejected] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: readerId,
        parentId: null,
        body: "Rejected.",
        status: "rejected",
      })
      .returning({ id: comments.id });

    asAdmin();
    const result = await restoreRejectedComment(rejected!.id);
    expect(result).toEqual({ ok: true, data: { id: rejected!.id } });
  });
});
