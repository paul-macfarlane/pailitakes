import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sweepStalePostFixtures } from "@/test/helpers";

// vi.hoisted lifts this above the mock factory (TDZ otherwise) — same
// pattern as src/lib/posts/posts.test.ts: one pool/db serves both the mocked
// "@/db" (used by data.ts) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const {
  applyCommentEdit,
  casCommentStatus,
  commentHasChildren,
  countRecentCommentsByAuthor,
  hardDeleteCommentIfChildless,
  insertComment,
  isParentDeletedRace,
  listModerationLogRows,
  loadCommentForDelete,
  loadCommentForEdit,
  loadCommentRowsForPost,
  loadPostForComment,
  parentIsValidForReply,
  setPostCommentsLockedColumn,
  softDeleteComment,
} = await import("./data");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-data-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;
const otherAuthorId = `user-${runId}-other`;
const bannedAuthorId = `user-${runId}-banned`;

const T = new Date("2026-02-01T12:00:00Z");
const seconds = (n: number) => new Date(T.getTime() + n * 1000);

let categoryId: number;
let visiblePostId: string;
let draftPostId: string;

const VERDICT_ALLOW = {
  verdict: "allow" as const,
  reason: "fine",
  model: "test-model",
  latencyMs: 1,
};

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });

  await testDb.insert(user).values([
    {
      id: authorId,
      name: `Test Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "reader",
    },
    {
      id: otherAuthorId,
      name: `Test Other ${runId}`,
      email: `other-${runId}@example.com`,
      role: "reader",
    },
    {
      id: bannedAuthorId,
      name: `Test Banned ${runId}`,
      email: `banned-${runId}@example.com`,
      role: "reader",
      bannedAt: seconds(-3600),
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
      publishAt: seconds(-60),
      commentsLocked: false,
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
});

afterAll(async () => {
  await testDb
    .delete(comments)
    .where(inArray(comments.postId, [visiblePostId, draftPostId]));
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb
    .delete(user)
    .where(inArray(user.id, [authorId, otherAuthorId, bannedAuthorId]));
  await pool.end();
});

describe("loadPostForComment", () => {
  it("returns commentsLocked for a publicly visible post", async () => {
    expect(await loadPostForComment(visiblePostId, T)).toEqual({
      commentsLocked: false,
    });
  });

  it("returns undefined for a post that isn't publicly visible (draft)", async () => {
    expect(await loadPostForComment(draftPostId, T)).toBeUndefined();
  });

  it("returns undefined for an unknown post id", async () => {
    expect(
      await loadPostForComment("00000000-0000-4000-8000-000000000000", T),
    ).toBeUndefined();
  });

  it("reflects a locked post's commentsLocked=true", async () => {
    await testDb
      .update(posts)
      .set({ commentsLocked: true })
      .where(eq(posts.id, visiblePostId));
    expect(await loadPostForComment(visiblePostId, T)).toEqual({
      commentsLocked: true,
    });
    await testDb
      .update(posts)
      .set({ commentsLocked: false })
      .where(eq(posts.id, visiblePostId));
  });
});

describe("parentIsValidForReply / insertComment / loadCommentRowsForPost", () => {
  it("accepts a visible parent on the same post and rejects everything else", async () => {
    const visibleParent = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "Parent.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });
    const heldParent = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "Held parent.",
      status: "held",
      modVerdict: { error: "timeout", model: "test-model", latencyMs: 1 },
    });
    const otherPostParent = await insertComment({
      postId: draftPostId,
      parentId: null,
      authorId,
      body: "Other post parent.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });

    expect(await parentIsValidForReply(visibleParent.id, visiblePostId)).toBe(
      true,
    );
    expect(await parentIsValidForReply(heldParent.id, visiblePostId)).toBe(
      false,
    );
    expect(await parentIsValidForReply(otherPostParent.id, visiblePostId)).toBe(
      false,
    );
    expect(
      await parentIsValidForReply(
        "00000000-0000-4000-8000-000000000001",
        visiblePostId,
      ),
    ).toBe(false);
  });

  it("loadCommentRowsForPost returns every status with the author joined", async () => {
    const postId = visiblePostId;
    const visible = await insertComment({
      postId,
      parentId: null,
      authorId,
      body: "Visible body.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });
    const rejected = await insertComment({
      postId,
      parentId: null,
      authorId: otherAuthorId,
      body: "Rejected body.",
      status: "rejected",
      modVerdict: {
        verdict: "flag",
        reason: "profanity",
        model: "m",
        latencyMs: 1,
      },
    });

    const rows = await loadCommentRowsForPost(postId);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(visible.id)).toMatchObject({
      body: "Visible body.",
      status: "visible",
      authorId,
      authorName: `Test Author ${runId}`,
    });
    expect(byId.get(rejected.id)).toMatchObject({
      body: "Rejected body.",
      status: "rejected",
      authorId: otherAuthorId,
    });
  });
});

describe("countRecentCommentsByAuthor", () => {
  it("counts only this author's rows created after the cutoff, across all statuses", async () => {
    const rateRunAuthorId = `${authorId}-rate`;
    await testDb.insert(user).values({
      id: rateRunAuthorId,
      name: "Rate Author",
      email: `rate-${runId}@example.com`,
      role: "reader",
    });

    const base = seconds(1000);
    await testDb.insert(comments).values([
      {
        postId: visiblePostId,
        authorId: rateRunAuthorId,
        parentId: null,
        body: "old",
        status: "visible",
        createdAt: new Date(base.getTime() - 10_000),
      },
      {
        postId: visiblePostId,
        authorId: rateRunAuthorId,
        parentId: null,
        body: "recent-1",
        status: "held",
        createdAt: new Date(base.getTime() + 1_000),
      },
      {
        postId: visiblePostId,
        authorId: rateRunAuthorId,
        parentId: null,
        body: "recent-2",
        status: "rejected",
        createdAt: new Date(base.getTime() + 2_000),
      },
      {
        // Different author — must not be counted.
        postId: visiblePostId,
        authorId: otherAuthorId,
        parentId: null,
        body: "other author",
        status: "visible",
        createdAt: new Date(base.getTime() + 1_500),
      },
    ]);

    const count = await countRecentCommentsByAuthor(rateRunAuthorId, base);
    // Only the two rows strictly after `base` (held + rejected both count —
    // design D6: all statuses burn the rate limit).
    expect(count).toBe(2);

    await testDb.delete(comments).where(eq(comments.authorId, rateRunAuthorId));
    await testDb.delete(user).where(eq(user.id, rateRunAuthorId));
  });

  it("also counts a row created before the cutoff but edited after it (edits burn the same budget)", async () => {
    const rateRunAuthorId = `${authorId}-rate-edit`;
    await testDb.insert(user).values({
      id: rateRunAuthorId,
      name: "Rate Edit Author",
      email: `rate-edit-${runId}@example.com`,
      role: "reader",
    });

    const base = seconds(2000);
    await testDb.insert(comments).values([
      {
        // Created well before the cutoff and never edited — must not count.
        postId: visiblePostId,
        authorId: rateRunAuthorId,
        parentId: null,
        body: "stale",
        status: "visible",
        createdAt: new Date(base.getTime() - 10_000),
      },
      {
        // Created well before the cutoff but edited after it — the fresh
        // edit is a fresh moderation call and must still count.
        postId: visiblePostId,
        authorId: rateRunAuthorId,
        parentId: null,
        body: "edited-after-cutoff",
        status: "visible",
        createdAt: new Date(base.getTime() - 10_000),
        editedAt: new Date(base.getTime() + 1_000),
      },
    ]);

    expect(await countRecentCommentsByAuthor(rateRunAuthorId, base)).toBe(1);

    await testDb.delete(comments).where(eq(comments.authorId, rateRunAuthorId));
    await testDb.delete(user).where(eq(user.id, rateRunAuthorId));
  });
});

describe("isParentDeletedRace", () => {
  it("classifies a real FK violation from inserting a reply to a just-deleted parent", async () => {
    const parent = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "About to be deleted.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });
    expect(await hardDeleteCommentIfChildless(parent.id)).toBe(true);

    let caught: unknown;
    try {
      await insertComment({
        postId: visiblePostId,
        parentId: parent.id,
        authorId,
        body: "Reply to a comment that no longer exists.",
        status: "visible",
        modVerdict: VERDICT_ALLOW,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isParentDeletedRace(caught)).toBe(true);
  });

  it("returns false for an unrelated FK violation and for non-FK errors", () => {
    expect(
      isParentDeletedRace({
        code: "23503",
        constraint: "comments_post_id_posts_id_fk",
      }),
    ).toBe(false);
    expect(isParentDeletedRace({ code: "23505", constraint: "anything" })).toBe(
      false,
    );
    expect(isParentDeletedRace(new Error("unrelated"))).toBe(false);
    expect(isParentDeletedRace(null)).toBe(false);
  });
});

describe("edit: loadCommentForEdit / applyCommentEdit", () => {
  it("applies body + status + verdict + editedAt in one write", async () => {
    const inserted = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "Original.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });

    const loaded = await loadCommentForEdit(inserted.id);
    expect(loaded).toMatchObject({
      id: inserted.id,
      authorId,
      postId: visiblePostId,
      parentId: null,
      status: "visible",
    });

    const flagVerdict = {
      verdict: "flag" as const,
      reason: "profanity",
      model: "m",
      latencyMs: 2,
    };
    const editedAt = await applyCommentEdit(
      inserted.id,
      "Edited body.",
      "rejected",
      flagVerdict,
    );
    expect(editedAt).toBeInstanceOf(Date);

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted.id));
    expect(row).toMatchObject({
      body: "Edited body.",
      status: "rejected",
      modVerdict: flagVerdict,
    });
    expect(row!.editedAt).not.toBeNull();
  });
});

describe("delete: loadCommentForDelete / commentHasChildren / softDeleteComment / hardDeleteCommentIfChildless", () => {
  it("hard-deletes a childless comment", async () => {
    const inserted = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "Childless.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });

    expect(await loadCommentForDelete(inserted.id)).toMatchObject({
      id: inserted.id,
      authorId,
      postId: visiblePostId,
    });
    expect(await commentHasChildren(inserted.id)).toBe(false);
    expect(await hardDeleteCommentIfChildless(inserted.id)).toBe(true);

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted.id));
    expect(row).toBeUndefined();
  });

  it("refuses to hard-delete a comment with a child (race-safe guard)", async () => {
    const parent = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "Parent with a child.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });
    await insertComment({
      postId: visiblePostId,
      parentId: parent.id,
      authorId: otherAuthorId,
      body: "Child.",
      status: "visible",
      modVerdict: VERDICT_ALLOW,
    });

    expect(await commentHasChildren(parent.id)).toBe(true);
    expect(await hardDeleteCommentIfChildless(parent.id)).toBe(false);

    await softDeleteComment(parent.id);
    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, parent.id));
    expect(row).toMatchObject({ status: "deleted", body: "" });
  });
});

describe("setPostCommentsLockedColumn", () => {
  it("locks and unlocks, and returns false for an unknown post", async () => {
    expect(await setPostCommentsLockedColumn(visiblePostId, true)).toBe(true);
    expect((await loadPostForComment(visiblePostId, T))?.commentsLocked).toBe(
      true,
    );

    expect(await setPostCommentsLockedColumn(visiblePostId, false)).toBe(true);
    expect(
      await setPostCommentsLockedColumn(
        "00000000-0000-4000-8000-000000000002",
        true,
      ),
    ).toBe(false);
  });
});

describe("listModerationLogRows / casCommentStatus", () => {
  // listModerationLogRows is deliberately unscoped (a site-wide admin view,
  // design D9) — other test files running concurrently against the same
  // local Postgres also insert held/rejected rows, so this test can't assume
  // it's the only source of held/rejected comments in the table. Assertions
  // below use presence checks (our known ids show up, correctly joined) and
  // one-directional counts (>= our own rows) rather than exact positions —
  // the limit+1/slice hasMore mechanic itself is the same pattern already
  // exercised by src/lib/posts/posts.ts and src/lib/users/admin.ts.
  it("filters by status, joins post/author, and CASes held/rejected back to visible", async () => {
    const held1 = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "held 1",
      status: "held",
      modVerdict: { error: "e", model: "m", latencyMs: 1 },
    });
    const held2 = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "held 2",
      status: "held",
      modVerdict: { error: "e", model: "m", latencyMs: 1 },
    });
    const rejected1 = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId,
      body: "rejected 1",
      status: "rejected",
      modVerdict: { verdict: "flag", reason: "r", model: "m", latencyMs: 1 },
    });
    // CMT-10: a held comment from a banned author — asserts bannedAt flows
    // through the join so the moderation log can surface the auto-ban
    // without cross-referencing /admin/users.
    const heldFromBannedAuthor = await insertComment({
      postId: visiblePostId,
      parentId: null,
      authorId: bannedAuthorId,
      body: "held from banned author",
      status: "held",
      modVerdict: { error: "e", model: "m", latencyMs: 1 },
    });

    // Large enough to safely capture our own rows alongside any concurrent
    // noise from other test files.
    const heldPage = await listModerationLogRows({
      status: "held",
      limit: 1000,
      offset: 0,
    });
    const heldById = new Map(heldPage.rows.map((r) => [r.id, r]));
    expect(heldById.get(held1.id)).toMatchObject({
      status: "held",
      post: { slug: `${runId}-visible` },
      author: {
        name: `Test Author ${runId}`,
        email: `author-${runId}@example.com`,
        bannedAt: null,
      },
    });
    expect(heldById.has(held2.id)).toBe(true);
    expect(heldById.get(heldFromBannedAuthor.id)?.author.bannedAt).toEqual(
      seconds(-3600),
    );

    // limit smaller than our own known held count is guaranteed to report
    // hasMore=true regardless of concurrent noise (noise only adds rows).
    const heldFirstPage = await listModerationLogRows({
      status: "held",
      limit: 1,
      offset: 0,
    });
    expect(heldFirstPage.rows).toHaveLength(1);
    expect(heldFirstPage.hasMore).toBe(true);

    const rejectedPage = await listModerationLogRows({
      status: "rejected",
      limit: 1000,
      offset: 0,
    });
    expect(rejectedPage.rows.map((r) => r.id)).toContain(rejected1.id);

    expect(await casCommentStatus(held1.id, "held", "visible")).toBe(true);
    // Already moved — a second CAS from the same fromStatus matches nothing.
    expect(await casCommentStatus(held1.id, "held", "visible")).toBe(false);
    expect(await casCommentStatus(rejected1.id, "rejected", "visible")).toBe(
      true,
    );
  });

  // The comment above explains why this suite avoids positional assertions
  // on the raw result — but the ORDER BY itself still needs pinning. Seed
  // 3 held rows with distinct created_at, request a generous limit (so ours
  // are guaranteed to be on the page even with concurrent noise from other
  // test files), then FILTER to just this run's own ids: their relative
  // order within that filtered subsequence is stable — newest-first — no
  // matter how many foreign rows from concurrent suites interleave.
  it("orders newest-first (desc createdAt, desc id)", async () => {
    const base = seconds(3000);
    const seeded = await testDb
      .insert(comments)
      .values([
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "order oldest",
          status: "held",
          createdAt: new Date(base.getTime()),
        },
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "order middle",
          status: "held",
          createdAt: new Date(base.getTime() + 1_000),
        },
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "order newest",
          status: "held",
          createdAt: new Date(base.getTime() + 2_000),
        },
      ])
      .returning({ id: comments.id });
    const seededIds = new Set(seeded.map((row) => row.id));

    const { rows } = await listModerationLogRows({
      status: "held",
      limit: 1000,
      offset: 0,
    });

    const ownRows = rows.filter((r) => seededIds.has(r.id));
    expect(ownRows).toHaveLength(3);
    const createdAts = ownRows.map((r) => r.createdAt.getTime());
    expect(createdAts).toEqual([...createdAts].sort((a, b) => b - a));

    await testDb.delete(comments).where(inArray(comments.id, [...seededIds]));
  });
});
