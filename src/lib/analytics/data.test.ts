import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { AnalyticsGranularity } from "@/lib/analytics/input";
import { sweepStalePostFixtures } from "@/test/helpers";

// vi.hoisted lifts this above the mock factory (TDZ otherwise) — same
// pattern as src/lib/comments/data.test.ts: one pool/db serves both the
// mocked "@/db" (used by data.ts) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const {
  countViewsByBucket,
  countViewsByCategory,
  insertPageView,
  InsertPageViewResult,
  viewsAndEngagementByPost,
} = await import("./data");

const { categories, comments, pageViews, postLikes, posts, user } = schema;

const SEED_PREFIX = "t-anly-data-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}-author`;
const readerId = `user-${runId}-reader`;
const extraLikerId = `user-${runId}-extra-liker`;
// Every page_views row this file inserts (via insertPageView or direct
// testDb.insert) uses a path starting with this prefix, so afterAll can clean
// up in one LIKE regardless of postId (null-postId rows have no other handle
// to scope by).
const PATH_PREFIX = `/${runId}`;

const T = new Date("2026-03-01T12:00:00Z");

let categoryAId: number;
let categoryBId: number;
let categoryOtherId: number;
let postAId: string; // category A — countViewsByCategory
let postBId: string; // category B — countViewsByCategory
let bucketPostId: string; // countViewsByBucket (bucketing/uniques/since/order)
let engagementPostId: string; // viewsAndEngagementByPost happy path
let zeroViewsPostId: string; // has comments/likes but never a page view
let lowViewsPostId: string; // viewsAndEngagementByPost ordering/limit

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });

  await testDb.insert(user).values([
    {
      id: authorId,
      name: `Test Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "author",
    },
    {
      id: readerId,
      name: `Test Reader ${runId}`,
      email: `reader-${runId}@example.com`,
      role: "reader",
    },
    {
      id: extraLikerId,
      name: `Test Extra Liker ${runId}`,
      email: `extra-liker-${runId}@example.com`,
      role: "reader",
    },
  ]);

  const [categoryA] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}-a`, name: `Category A ${runId}` })
    .returning({ id: categories.id });
  categoryAId = categoryA!.id;

  const [categoryB] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}-b`, name: `Category B ${runId}` })
    .returning({ id: categories.id });
  categoryBId = categoryB!.id;

  // Every post EXCEPT postA/postB lives here — keeps the countViewsByCategory
  // assertions (which sum by category with an open-ended `since`) isolated
  // from the page views seeded by the bucket/engagement describe blocks.
  const [categoryOther] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}-other`, name: `Category Other ${runId}` })
    .returning({ id: categories.id });
  categoryOtherId = categoryOther!.id;

  async function seedPost(suffix: string, categoryId: number) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `Post ${runId} ${suffix}`,
        slug: `${runId}-${suffix}`,
        bodyMd: "Body.",
        thumbnailUrl: "https://example.com/thumb.jpg",
        categoryId,
        status: "published",
        publishAt: T,
      })
      .returning({ id: posts.id });
    return row!.id;
  }

  postAId = await seedPost("a", categoryAId);
  postBId = await seedPost("b", categoryBId);
  bucketPostId = await seedPost("bucket", categoryOtherId);
  engagementPostId = await seedPost("engagement", categoryOtherId);
  zeroViewsPostId = await seedPost("zero-views", categoryOtherId);
  lowViewsPostId = await seedPost("low-views", categoryOtherId);
});

afterAll(async () => {
  await testDb.delete(pageViews).where(like(pageViews.path, `${PATH_PREFIX}%`));
  const ownPostIds = [
    postAId,
    postBId,
    bucketPostId,
    engagementPostId,
    zeroViewsPostId,
    lowViewsPostId,
  ];
  await testDb.delete(postLikes).where(inArray(postLikes.postId, ownPostIds));
  await testDb.delete(comments).where(inArray(comments.postId, ownPostIds));
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb
    .delete(categories)
    .where(inArray(categories.id, [categoryAId, categoryBId, categoryOtherId]));
  await testDb
    .delete(user)
    .where(inArray(user.id, [authorId, readerId, extraLikerId]));
  await pool.end();
});

describe("insertPageView", () => {
  it("inserts a row for a known post and returns Inserted", async () => {
    const path = `${PATH_PREFIX}/insert-known`;
    const result = await insertPageView({
      postId: bucketPostId,
      path,
      visitorHash: `vh-${runId}-insert-known`,
    });
    expect(result).toBe(InsertPageViewResult.Inserted);

    const rows = await testDb
      .select()
      .from(pageViews)
      .where(eq(pageViews.path, path));
    expect(rows).toMatchObject([
      { postId: bucketPostId, visitorHash: `vh-${runId}-insert-known` },
    ]);
  });

  it("returns UnknownPost and inserts no row for a post id that doesn't exist", async () => {
    const path = `${PATH_PREFIX}/insert-unknown`;
    const result = await insertPageView({
      postId: "00000000-0000-4000-8000-000000000099",
      path,
      visitorHash: `vh-${runId}-insert-unknown`,
    });
    expect(result).toBe(InsertPageViewResult.UnknownPost);

    const rows = await testDb
      .select()
      .from(pageViews)
      .where(eq(pageViews.path, path));
    expect(rows).toHaveLength(0);
  });

  it("accepts a null postId for a non-post page", async () => {
    const path = `${PATH_PREFIX}/insert-null`;
    const result = await insertPageView({
      postId: null,
      path,
      visitorHash: `vh-${runId}-insert-null`,
    });
    expect(result).toBe(InsertPageViewResult.Inserted);

    const rows = await testDb
      .select()
      .from(pageViews)
      .where(eq(pageViews.path, path));
    expect(rows).toMatchObject([{ postId: null }]);
  });
});

describe("countViewsByBucket", () => {
  // Pins the sql.raw GROUP BY fix (data.ts GRANULARITY_SQL comment): each
  // granularity renders date_trunc's literal into select/groupBy/orderBy —
  // if any of the three used a fresh bound parameter instead, Postgres would
  // reject the query ("column must appear in the GROUP BY clause").
  it.each([
    ["day", AnalyticsGranularity.Day],
    ["week", AnalyticsGranularity.Week],
    ["month", AnalyticsGranularity.Month],
  ] as const)(
    "executes without error for granularity=%s",
    async (_name, granularity) => {
      const result = await countViewsByBucket({ granularity, since: null });
      expect(Array.isArray(result)).toBe(true);
    },
  );

  it("buckets by UTC calendar day regardless of the instant's local wall-clock date", async () => {
    // 23:30 UTC on the 10th and 00:30 UTC on the 11th sit 1 hour apart but
    // must land in different day buckets — proves `at time zone 'utc'` is
    // applied before date_trunc, not the session's own timezone.
    const day1 = new Date("2026-07-10T23:30:00Z");
    const day2 = new Date("2026-07-11T00:30:00Z");
    await testDb.insert(pageViews).values([
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/utc-day`,
        visitorHash: `vh-${runId}-utc-1`,
        createdAt: day1,
      },
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/utc-day`,
        visitorHash: `vh-${runId}-utc-2`,
        createdAt: day2,
      },
    ]);

    const buckets = await countViewsByBucket({
      granularity: AnalyticsGranularity.Day,
      since: new Date(day1.getTime() - 1000),
    });
    const byLabel = new Map(buckets.map((b) => [b.bucket, b]));
    expect(byLabel.get("2026-07-10")).toMatchObject({ views: 1, uniques: 1 });
    expect(byLabel.get("2026-07-11")).toMatchObject({ views: 1, uniques: 1 });
  });

  it("counts views vs unique visitors (repeat visitor + one distinct visitor)", async () => {
    const at = new Date("2026-06-01T10:00:00Z");
    await testDb.insert(pageViews).values([
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/uniques`,
        visitorHash: `vh-${runId}-dup`,
        createdAt: at,
      },
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/uniques`,
        visitorHash: `vh-${runId}-dup`,
        createdAt: new Date(at.getTime() + 60_000),
      },
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/uniques`,
        visitorHash: `vh-${runId}-solo`,
        createdAt: new Date(at.getTime() + 120_000),
      },
    ]);

    const buckets = await countViewsByBucket({
      granularity: AnalyticsGranularity.Day,
      since: new Date(at.getTime() - 1000),
    });
    expect(buckets.find((b) => b.bucket === "2026-06-01")).toMatchObject({
      views: 3,
      uniques: 2,
    });
  });

  it("`since` excludes older rows, `since: null` includes them, and buckets are ordered ascending", async () => {
    const older = new Date("2026-05-01T00:00:00Z");
    const newer = new Date("2026-05-05T00:00:00Z");
    const cutoff = new Date("2026-05-03T00:00:00Z");
    await testDb.insert(pageViews).values([
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/since`,
        visitorHash: `vh-${runId}-since-old`,
        createdAt: older,
      },
      {
        postId: bucketPostId,
        path: `${PATH_PREFIX}/since`,
        visitorHash: `vh-${runId}-since-new`,
        createdAt: newer,
      },
    ]);

    const filtered = await countViewsByBucket({
      granularity: AnalyticsGranularity.Day,
      since: cutoff,
    });
    const filteredLabels = filtered.map((b) => b.bucket);
    expect(filteredLabels).not.toContain("2026-05-01");
    expect(filteredLabels).toContain("2026-05-05");

    const unfiltered = await countViewsByBucket({
      granularity: AnalyticsGranularity.Day,
      since: null,
    });
    const unfilteredLabels = unfiltered.map((b) => b.bucket);
    expect(unfilteredLabels).toContain("2026-05-01");
    expect(unfilteredLabels).toContain("2026-05-05");
    // date_trunc's output orders lexically the same as chronologically for
    // the 'YYYY-MM-DD' label format, so a plain string sort pins ORDER BY.
    expect(unfilteredLabels).toEqual([...unfilteredLabels].sort());
  });
});

describe("countViewsByCategory", () => {
  it("excludes null-postId views and groups counts by category, ordered desc", async () => {
    const at = new Date("2026-04-01T00:00:00Z");
    await testDb.insert(pageViews).values([
      {
        postId: postAId,
        path: `${PATH_PREFIX}/cat`,
        visitorHash: `vh-${runId}-cat-a1`,
        createdAt: at,
      },
      {
        postId: postAId,
        path: `${PATH_PREFIX}/cat`,
        visitorHash: `vh-${runId}-cat-a2`,
        createdAt: at,
      },
      {
        postId: postAId,
        path: `${PATH_PREFIX}/cat`,
        visitorHash: `vh-${runId}-cat-a3`,
        createdAt: at,
      },
      {
        postId: postBId,
        path: `${PATH_PREFIX}/cat`,
        visitorHash: `vh-${runId}-cat-b1`,
        createdAt: at,
      },
      // Home/non-post page — has no category, so must never surface as a
      // phantom category row.
      {
        postId: null,
        path: `${PATH_PREFIX}/cat-home`,
        visitorHash: `vh-${runId}-cat-null`,
        createdAt: at,
      },
    ]);

    const results = await countViewsByCategory({
      since: new Date(at.getTime() - 1000),
    });
    const byId = new Map(results.map((r) => [r.categoryId, r]));

    expect(byId.get(categoryAId)).toMatchObject({
      name: `Category A ${runId}`,
      views: 3,
    });
    expect(byId.get(categoryBId)).toMatchObject({
      name: `Category B ${runId}`,
      views: 1,
    });

    const ownOrder = results
      .filter(
        (r) => r.categoryId === categoryAId || r.categoryId === categoryBId,
      )
      .map((r) => r.categoryId);
    expect(ownOrder).toEqual([categoryAId, categoryBId]);
  });
});

describe("viewsAndEngagementByPost", () => {
  // Later than every other explicit createdAt used elsewhere in this file
  // (April/May/June/July above) — countViewsByBucket-style tests never
  // scope their `since` upper end, so an ordering/limit assertion here needs
  // a window no other seeded row in this file falls after.
  const windowSince = new Date("2026-08-01T00:00:00Z");
  const before = new Date(windowSince.getTime() - 60 * 60 * 1000);
  const after = new Date(windowSince.getTime() + 60 * 60 * 1000);

  it("counts views/comments/likes inside the window, excludes out-of-window rows and zero-view posts, orders by views desc, and respects limit", async () => {
    await testDb.insert(pageViews).values([
      {
        postId: engagementPostId,
        path: `${PATH_PREFIX}/eng`,
        visitorHash: `vh-${runId}-eng-1`,
        createdAt: after,
      },
      {
        postId: engagementPostId,
        path: `${PATH_PREFIX}/eng`,
        visitorHash: `vh-${runId}-eng-2`,
        createdAt: after,
      },
      {
        postId: engagementPostId,
        path: `${PATH_PREFIX}/eng`,
        visitorHash: `vh-${runId}-eng-3`,
        createdAt: after,
      },
      // Out-of-window view — the FROM page_views join already scopes
      // "views" to `since`, so this must not be counted.
      {
        postId: engagementPostId,
        path: `${PATH_PREFIX}/eng`,
        visitorHash: `vh-${runId}-eng-old`,
        createdAt: before,
      },
      {
        postId: lowViewsPostId,
        path: `${PATH_PREFIX}/eng-low`,
        visitorHash: `vh-${runId}-low-1`,
        createdAt: after,
      },
    ]);

    await testDb.insert(comments).values([
      {
        postId: engagementPostId,
        authorId,
        parentId: null,
        body: "in-window visible",
        status: "visible",
        createdAt: after,
      },
      {
        postId: engagementPostId,
        authorId,
        parentId: null,
        body: "in-window visible 2",
        status: "visible",
        createdAt: after,
      },
      // Held (not visible) — must not be counted even though it's in-window.
      {
        postId: engagementPostId,
        authorId,
        parentId: null,
        body: "in-window held",
        status: "held",
        createdAt: after,
      },
      // Visible but out-of-window — must not be counted either.
      {
        postId: engagementPostId,
        authorId,
        parentId: null,
        body: "out-of-window visible",
        status: "visible",
        createdAt: before,
      },
      // zeroViewsPostId never gets a page_views row, but it does get
      // engagement — proves absence is driven by the views join, not by
      // having no comments/likes at all.
      {
        postId: zeroViewsPostId,
        authorId,
        parentId: null,
        body: "zero-views post comment",
        status: "visible",
        createdAt: after,
      },
    ]);

    await testDb.insert(postLikes).values([
      { postId: engagementPostId, userId: authorId, createdAt: after },
      { postId: engagementPostId, userId: readerId, createdAt: after },
      // Out-of-window like — must not be counted.
      { postId: engagementPostId, userId: extraLikerId, createdAt: before },
      { postId: zeroViewsPostId, userId: authorId, createdAt: after },
    ]);

    const results = await viewsAndEngagementByPost({
      since: windowSince,
      limit: 50,
    });
    const byId = new Map(results.map((r) => [r.postId, r]));

    expect(byId.get(engagementPostId)).toMatchObject({
      views: 3,
      comments: 2,
      likes: 2,
    });
    expect(byId.has(zeroViewsPostId)).toBe(false);
    expect(byId.get(lowViewsPostId)).toMatchObject({
      views: 1,
      comments: 0,
      likes: 0,
    });

    const ownOrder = results
      .filter(
        (r) => r.postId === engagementPostId || r.postId === lowViewsPostId,
      )
      .map((r) => r.postId);
    expect(ownOrder).toEqual([engagementPostId, lowViewsPostId]);

    const limited = await viewsAndEngagementByPost({
      since: windowSince,
      limit: 1,
    });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.postId).toBe(engagementPostId);
  });
});
