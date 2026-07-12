import { eq, inArray, like } from "drizzle-orm";
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

// vi.hoisted lifts this above the mock factories (TDZ otherwise) — one
// pool/db serves both the mocked "@/db" and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

// moderateComment calls the AI Gateway over the network — every case here
// controls its outcome directly rather than hitting a real model.
const moderateCommentMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/comments/moderation", () => ({
  moderateComment: moderateCommentMock,
}));

// env.ts parses process.env at import time and isn't populated with real
// values under an isolated vitest run (same reason the cron route test
// mocks it) — pin the rate-limit config the boundary tests below assert
// against instead of depending on ambient .env.
vi.mock("@/lib/shared/env", () => ({
  env: { COMMENT_RATE_LIMIT_PER_MINUTE: 3, COMMENT_RATE_LIMIT_PER_HOUR: 30 },
}));

const { createComment, editOwnComment } = await import("./create");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-create-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const authorId = `user-${runId}-author`;
const otherAuthorId = `user-${runId}-other`;

let categoryId: number;
let visiblePostId: string;
let draftPostId: string;
let lockedPostId: string;

const READER = {
  id: authorId,
  name: `Test Author ${runId}`,
  image: null,
  role: "reader",
  bannedAt: null,
};
const OTHER_READER = {
  id: otherAuthorId,
  name: `Other Author ${runId}`,
  image: null,
  role: "reader",
  bannedAt: null,
};

const ALLOW = {
  outcome: "allow" as const,
  reason: "clean take",
  record: {
    verdict: "allow" as const,
    reason: "clean take",
    model: "m",
    latencyMs: 1,
  },
};
const FLAG = {
  outcome: "flag" as const,
  reason: "profanity",
  record: {
    verdict: "flag" as const,
    reason: "profanity",
    model: "m",
    latencyMs: 1,
  },
};
const ERROR = {
  outcome: "error" as const,
  record: { error: "timeout", model: "m", latencyMs: 1 },
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
      name: `Other Author ${runId}`,
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
      authorId,
      title: `Post ${runId} visible`,
      slug: `${runId}-visible`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(now.getTime() - 60_000),
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

  const [lockedPost] = await testDb
    .insert(posts)
    .values({
      authorId,
      title: `Post ${runId} locked`,
      slug: `${runId}-locked`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(now.getTime() - 60_000),
      commentsLocked: true,
    })
    .returning({ id: posts.id });
  lockedPostId = lockedPost!.id;
});

afterAll(async () => {
  await testDb
    .delete(comments)
    .where(
      inArray(comments.postId, [visiblePostId, draftPostId, lockedPostId]),
    );
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [authorId, otherAuthorId]));
  await pool.end();
});

beforeEach(() => {
  moderateCommentMock.mockReset();
});

async function clearAuthorComments(id: string) {
  await testDb.delete(comments).where(eq(comments.authorId, id));
}

describe("createComment", () => {
  it("denies a banned caller with a typed reason, without calling moderation", async () => {
    const result = await createComment(visiblePostId, null, "Hi.", {
      ...READER,
      bannedAt: new Date(),
    });
    expect(result).toEqual({
      status: "denied",
      reason: "banned",
      message: expect.any(String),
    });
    expect(moderateCommentMock).not.toHaveBeenCalled();
  });

  it("errors (defense in depth) for a caller whose role has no CreateComment grant", async () => {
    const result = await createComment(visiblePostId, null, "Hi.", {
      ...READER,
      role: "not-a-real-role",
    });
    expect(result).toEqual({ status: "error", message: expect.any(String) });
    expect(moderateCommentMock).not.toHaveBeenCalled();
  });

  it("denies with 'archived' when the post doesn't exist or isn't publicly visible", async () => {
    const result = await createComment(draftPostId, null, "Hi.", READER);
    expect(result).toEqual({
      status: "denied",
      reason: "archived",
      message: expect.any(String),
    });
  });

  it("denies with 'locked' when the post has comments_locked=true", async () => {
    const result = await createComment(lockedPostId, null, "Hi.", READER);
    expect(result).toEqual({
      status: "denied",
      reason: "locked",
      message: expect.any(String),
    });
  });

  it("errors when parentId doesn't reference a visible comment on the same post", async () => {
    moderateCommentMock.mockResolvedValue(ALLOW);
    const result = await createComment(
      visiblePostId,
      "00000000-0000-4000-8000-000000000099",
      "Reply to nothing.",
      READER,
    );
    expect(result).toEqual({
      status: "error",
      message: "Cannot reply to that comment.",
    });
  });

  it("maps the parent's hard-delete race (deleted between validation and insert) to the same 'cannot reply' error", async () => {
    await clearAuthorComments(authorId);
    // moderateComment (mocked) is where the seconds-long real-world gap
    // lives between the parent-validity check and the insert (design D7
    // steps 5 vs 7) — delete the parent as this call's side effect so the
    // insert below hits the FK for real instead of a synthesized error.
    const [parent] = await testDb
      .insert(comments)
      .values({
        postId: visiblePostId,
        authorId,
        parentId: null,
        body: "Parent about to vanish.",
        status: "visible",
      })
      .returning({ id: comments.id });
    moderateCommentMock.mockImplementation(async () => {
      await testDb.delete(comments).where(eq(comments.id, parent!.id));
      return ALLOW;
    });

    const result = await createComment(
      visiblePostId,
      parent!.id,
      "Reply to a parent that's about to be deleted.",
      READER,
    );

    expect(result).toEqual({
      status: "error",
      message: "Cannot reply to that comment.",
    });
  });

  it("allow -> visible: returns the full CommentNode and stores the verdict", async () => {
    await clearAuthorComments(authorId);
    moderateCommentMock.mockResolvedValue(ALLOW);

    const result = await createComment(
      visiblePostId,
      null,
      "Great game!",
      READER,
    );

    expect(result.status).toBe("visible");
    if (result.status !== "visible") return;
    expect(result.comment).toMatchObject({
      parentId: null,
      body: "Great game!",
      status: "visible",
      author: { id: authorId, name: READER.name, image: null },
      children: [],
    });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, result.comment.id));
    expect(row).toMatchObject({ status: "visible", modVerdict: ALLOW.record });
  });

  it("flag -> rejected: final, stores the verdict, no CommentNode returned", async () => {
    await clearAuthorComments(authorId);
    moderateCommentMock.mockResolvedValue(FLAG);

    const result = await createComment(
      visiblePostId,
      null,
      "Bad take.",
      READER,
    );

    expect(result).toEqual({ status: "rejected", message: expect.any(String) });
    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.authorId, authorId));
    expect(row).toMatchObject({ status: "rejected", modVerdict: FLAG.record });
  });

  it("error -> held: fails closed, stores the verdict", async () => {
    await clearAuthorComments(authorId);
    moderateCommentMock.mockResolvedValue(ERROR);

    const result = await createComment(
      visiblePostId,
      null,
      "Timeout case.",
      READER,
    );

    expect(result).toEqual({ status: "held", message: expect.any(String) });
    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.authorId, authorId));
    expect(row).toMatchObject({ status: "held", modVerdict: ERROR.record });
  });

  // Rate limit boundary matrix (design D6): >=3/min or >=30/hr denies (env
  // defaults, src/lib/shared/env.ts). All statuses count toward the limit.
  describe("rate limiting", () => {
    beforeEach(async () => {
      await clearAuthorComments(otherAuthorId);
      moderateCommentMock.mockResolvedValue(ALLOW);
    });
    afterAll(async () => {
      await clearAuthorComments(otherAuthorId);
    });

    it("allows the 3rd comment in a minute when only 2 prior exist (limit-1)", async () => {
      const now = new Date();
      await testDb.insert(comments).values([
        {
          postId: visiblePostId,
          authorId: otherAuthorId,
          parentId: null,
          body: "a",
          status: "held",
          createdAt: new Date(now.getTime() - 5_000),
        },
        {
          postId: visiblePostId,
          authorId: otherAuthorId,
          parentId: null,
          body: "b",
          status: "rejected",
          createdAt: new Date(now.getTime() - 3_000),
        },
      ]);

      const result = await createComment(
        visiblePostId,
        null,
        "Third in the minute.",
        OTHER_READER,
      );
      expect(result.status).toBe("visible");
    });

    it("denies the 4th comment in a minute when 3 prior exist (at the limit)", async () => {
      const now = new Date();
      await testDb.insert(comments).values([
        {
          postId: visiblePostId,
          authorId: otherAuthorId,
          parentId: null,
          body: "a",
          status: "visible",
          createdAt: new Date(now.getTime() - 5_000),
        },
        {
          postId: visiblePostId,
          authorId: otherAuthorId,
          parentId: null,
          body: "b",
          status: "held",
          createdAt: new Date(now.getTime() - 4_000),
        },
        {
          postId: visiblePostId,
          authorId: otherAuthorId,
          parentId: null,
          body: "c",
          status: "rejected",
          createdAt: new Date(now.getTime() - 3_000),
        },
      ]);

      const result = await createComment(
        visiblePostId,
        null,
        "Fourth in the minute.",
        OTHER_READER,
      );
      expect(result).toEqual({
        status: "denied",
        reason: "rate-limited",
        message: expect.any(String),
      });
      expect(moderateCommentMock).not.toHaveBeenCalled();
    });

    it("denies on the hourly window even when the minute window is clear", async () => {
      const now = new Date();
      const rows = Array.from({ length: 30 }, (_, i) => ({
        postId: visiblePostId,
        authorId: otherAuthorId,
        parentId: null,
        body: `hour-${i}`,
        status: "visible" as const,
        // Outside the 1-minute window but inside the 1-hour window.
        createdAt: new Date(now.getTime() - (5 * 60_000 + i * 1000)),
      }));
      await testDb.insert(comments).values(rows);

      const result = await createComment(
        visiblePostId,
        null,
        "Over the hourly cap.",
        OTHER_READER,
      );
      expect(result).toEqual({
        status: "denied",
        reason: "rate-limited",
        message: expect.any(String),
      });
    });
  });
});

describe("editOwnComment", () => {
  // Rate-limit fix: every test below now runs against a clean count for
  // `authorId` — an edit is a moderated submission and counts toward the
  // same limit as create (see "rate limiting" tests below), so leftover
  // rows from other tests could otherwise trip the limit unrelated to what
  // a given test is exercising.
  beforeEach(async () => {
    await clearAuthorComments(authorId);
  });

  it("denies a banned caller with a typed reason", async () => {
    const result = await editOwnComment(
      "00000000-0000-4000-8000-000000000001",
      "New body.",
      { ...READER, bannedAt: new Date() },
    );
    expect(result).toEqual({
      status: "denied",
      reason: "banned",
      message: expect.any(String),
    });
  });

  it("rejects editing a comment owned by someone else", async () => {
    moderateCommentMock.mockResolvedValue(ALLOW);
    const [inserted] = await testDb
      .insert(comments)
      .values({
        postId: visiblePostId,
        authorId,
        parentId: null,
        body: "Mine.",
        status: "visible",
      })
      .returning({ id: comments.id });

    const result = await editOwnComment(
      inserted!.id,
      "Hijacked.",
      OTHER_READER,
    );
    expect(result).toEqual({
      status: "error",
      message: expect.any(String),
    });

    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted!.id));
    expect(row!.body).toBe("Mine."); // unchanged
  });

  it("rejects editing a comment that is no longer visible", async () => {
    const [inserted] = await testDb
      .insert(comments)
      .values({
        postId: visiblePostId,
        authorId,
        parentId: null,
        body: "Held.",
        status: "held",
      })
      .returning({ id: comments.id });

    const result = await editOwnComment(inserted!.id, "New body.", READER);
    expect(result).toEqual({
      status: "error",
      message: "This comment can no longer be edited.",
    });
  });

  it("re-moderates: a flagged edit turns the comment rejected in one write", async () => {
    const [inserted] = await testDb
      .insert(comments)
      .values({
        postId: visiblePostId,
        authorId,
        parentId: null,
        body: "Clean.",
        status: "visible",
      })
      .returning({ id: comments.id });

    moderateCommentMock.mockResolvedValue(FLAG);
    const result = await editOwnComment(
      inserted!.id,
      "Edited to profanity.",
      READER,
    );

    expect(result).toEqual({ status: "rejected", message: expect.any(String) });
    const [row] = await testDb
      .select()
      .from(comments)
      .where(eq(comments.id, inserted!.id));
    expect(row).toMatchObject({
      status: "rejected",
      body: "Edited to profanity.",
      modVerdict: FLAG.record,
    });
    expect(row!.editedAt).not.toBeNull();
  });

  it("allow -> visible: returns the updated CommentNode with editedAt stamped", async () => {
    const [inserted] = await testDb
      .insert(comments)
      .values({
        postId: visiblePostId,
        authorId,
        parentId: null,
        body: "Original.",
        status: "visible",
      })
      .returning({ id: comments.id });

    moderateCommentMock.mockResolvedValue(ALLOW);
    const result = await editOwnComment(inserted!.id, "Updated take.", READER);

    expect(result.status).toBe("visible");
    if (result.status !== "visible") return;
    expect(result.comment).toMatchObject({
      id: inserted!.id,
      body: "Updated take.",
      status: "visible",
      author: { id: authorId, name: READER.name },
    });
    expect(result.comment.editedAt).not.toBeNull();
  });

  // Rate limit on edits (fix, supersedes design D4's "no rate limit on
  // edits"): each edit is a fresh moderation call and burns the same budget
  // as a create.
  describe("rate limiting", () => {
    it("denies an edit when the author is already at the limit, without re-moderating", async () => {
      await testDb.insert(comments).values([
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "a",
          status: "visible",
        },
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "b",
          status: "held",
        },
      ]);
      const [editable] = await testDb
        .insert(comments)
        .values({
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "Editable.",
          status: "visible",
        })
        .returning({ id: comments.id });

      const result = await editOwnComment(editable!.id, "New body.", READER);
      expect(result).toEqual({
        status: "denied",
        reason: "rate-limited",
        message: expect.any(String),
      });
      expect(moderateCommentMock).not.toHaveBeenCalled();
    });

    // The row count caps DISTINCT comments per window; one row re-edited in
    // a loop contributes 1 forever, so the per-comment cooldown is what
    // bounds a single comment's moderation calls.
    it("denies re-editing the same comment inside the cooldown, without re-moderating", async () => {
      const [editable] = await testDb
        .insert(comments)
        .values({
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "Editable.",
          status: "visible",
          // Old enough that neither rate-limit window counts the row itself.
          createdAt: new Date(Date.now() - 2 * 60 * 60_000),
          editedAt: new Date(Date.now() - 30_000),
        })
        .returning({ id: comments.id });

      const result = await editOwnComment(editable!.id, "Again.", READER);
      expect(result).toEqual({
        status: "denied",
        reason: "rate-limited",
        message: expect.any(String),
      });
      expect(moderateCommentMock).not.toHaveBeenCalled();
    });

    it("allows re-editing the same comment once the cooldown has passed", async () => {
      moderateCommentMock.mockResolvedValue(ALLOW);
      const [editable] = await testDb
        .insert(comments)
        .values({
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "Editable.",
          status: "visible",
          createdAt: new Date(Date.now() - 2 * 60 * 60_000),
          editedAt: new Date(Date.now() - 61_000),
        })
        .returning({ id: comments.id });

      const result = await editOwnComment(editable!.id, "Again.", READER);
      expect(result.status).toBe("visible");
    });

    it("a fresh edit's edited_at counts toward the limit for a subsequent submission", async () => {
      await testDb.insert(comments).values([
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "a",
          status: "visible",
        },
        {
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "b",
          status: "visible",
        },
      ]);
      const [editable] = await testDb
        .insert(comments)
        .values({
          postId: visiblePostId,
          authorId,
          parentId: null,
          body: "Old, about to be edited.",
          status: "visible",
          // Outside the 1-minute window (by created_at) but well inside the
          // 1-hour window — so editing it isn't itself rate-limited.
          createdAt: new Date(Date.now() - 10 * 60_000),
        })
        .returning({ id: comments.id });

      moderateCommentMock.mockResolvedValue(ALLOW);
      const editResult = await editOwnComment(editable!.id, "Edited.", READER);
      expect(editResult.status).toBe("visible");

      // The just-stamped edited_at now puts three rows in the 1-minute
      // window (a, b, and the just-edited row), denying a fourth submission.
      const createResult = await createComment(
        visiblePostId,
        null,
        "Fourth submission in the window.",
        READER,
      );
      expect(createResult).toEqual({
        status: "denied",
        reason: "rate-limited",
        message: expect.any(String),
      });
    });
  });
});
