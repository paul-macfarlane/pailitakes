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
import { sweepStalePostFixtures } from "@/test/helpers";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

// listModerationLogRows is a site-wide, unscoped query (design D9) — real
// held/rejected rows inserted by OTHER test files running concurrently
// against the same local Postgres would make an exact page1/page2 length
// assertion flaky. Mock just that one function (keeping casCommentStatus
// etc. real/DB-backed via importActual) so the page->offset arithmetic in
// listModerationLog is tested deterministically; the underlying SQL
// filter+limit+offset+hasMore mechanic is covered directly against the real
// DB in src/lib/comments/data.test.ts.
const listModerationLogRowsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/comments/data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comments/data")>(
    "@/lib/comments/data",
  );
  return { ...actual, listModerationLogRows: listModerationLogRowsMock };
});

const {
  approveHeldComment,
  listModerationLog,
  MODERATION_LOG_PAGE_SIZE,
  restoreRejectedComment,
} = await import("./moderation-log");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-modlog-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;

let categoryId: number;
let postId: string;

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
  await testDb.delete(user).where(inArray(user.id, [authorId]));
  await pool.end();
});

async function insertComment(status: "held" | "rejected" | "visible") {
  const [row] = await testDb
    .insert(comments)
    .values({
      postId,
      authorId,
      parentId: null,
      body: `Body ${status}`,
      status,
      modVerdict:
        status === "rejected"
          ? { verdict: "flag", reason: "r", model: "m", latencyMs: 1 }
          : { error: "e", model: "m", latencyMs: 1 },
    })
    .returning({ id: comments.id });
  return row!;
}

describe("listModerationLog", () => {
  beforeEach(() => {
    listModerationLogRowsMock.mockReset();
    listModerationLogRowsMock.mockResolvedValue({ rows: [], hasMore: false });
  });

  it("converts page 1 to offset 0 with the fixed page size", async () => {
    await listModerationLog({ status: "held", page: 1 });
    expect(listModerationLogRowsMock).toHaveBeenCalledWith({
      status: "held",
      limit: MODERATION_LOG_PAGE_SIZE,
      offset: 0,
    });
  });

  it("converts page 2 to an offset of one page size", async () => {
    await listModerationLog({ status: "rejected", page: 2 });
    expect(listModerationLogRowsMock).toHaveBeenCalledWith({
      status: "rejected",
      limit: MODERATION_LOG_PAGE_SIZE,
      offset: MODERATION_LOG_PAGE_SIZE,
    });
  });

  it("clamps a non-positive or non-finite page to page 1", async () => {
    await listModerationLog({ status: "held", page: 0 });
    expect(listModerationLogRowsMock).toHaveBeenLastCalledWith({
      status: "held",
      limit: MODERATION_LOG_PAGE_SIZE,
      offset: 0,
    });

    await listModerationLog({ status: "held", page: Number.NaN });
    expect(listModerationLogRowsMock).toHaveBeenLastCalledWith({
      status: "held",
      limit: MODERATION_LOG_PAGE_SIZE,
      offset: 0,
    });
  });

  it("passes the rows/hasMore result straight through", async () => {
    const rows = [{ id: "x" }];
    listModerationLogRowsMock.mockResolvedValue({ rows, hasMore: true });
    const result = await listModerationLog({ status: "held", page: 1 });
    expect(result).toEqual({ rows, hasMore: true });
  });
});

describe("approveHeldComment / restoreRejectedComment", () => {
  it("approves a held comment (CAS held -> visible)", async () => {
    const held = await insertComment("held");
    const result = await approveHeldComment(held.id);
    expect(result).toEqual({ ok: true, data: { id: held.id } });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, held.id));
    expect(row!.status).toBe("visible");
  });

  it("restores a rejected comment (CAS rejected -> visible)", async () => {
    const rejected = await insertComment("rejected");
    const result = await restoreRejectedComment(rejected.id);
    expect(result).toEqual({ ok: true, data: { id: rejected.id } });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, rejected.id));
    expect(row!.status).toBe("visible");
  });

  it("reports a conflict when the row no longer matches the expected fromStatus", async () => {
    const visible = await insertComment("held");
    await approveHeldComment(visible.id); // now visible

    const result = await approveHeldComment(visible.id); // stale: no longer held
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already resolved/i);
  });

  it("reports a conflict for an unknown id", async () => {
    const result = await restoreRejectedComment(
      "00000000-0000-4000-8000-000000000003",
    );
    expect(result.ok).toBe(false);
  });
});
