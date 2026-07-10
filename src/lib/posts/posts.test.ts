import { and, eq, inArray, like, lt, notExists, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

// vi.mock factories are hoisted above every other top-level statement in
// this file, so they can't close over a plain `const testDb = ...` (TDZ).
// vi.hoisted lifts this block above the mock factory, letting one pool/db
// serve both the mocked "@/db" (used by posts.ts — built without importing
// the real module, which would pull in src/lib/env.ts) and the seeding/
// cleanup code below.
const { pool, testDb } = await vi.hoisted(async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
});

vi.mock("@/db", () => ({ db: testDb }));

const { getVisiblePostBySlug, listVisiblePosts } = await import("./posts");

const { categories, postTags, posts, tags, user } = schema;

// Fixed marker on every seeded row (slugs, ids, emails) so a crashed run's
// leftovers — afterAll never ran — can be swept in beforeAll; the per-run id
// keeps rows unique within a run.
const SEED_PREFIX = "t-post2-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

// Reference time for the visibility matrix — never wall-clock (design §4).
const T = new Date("2026-01-15T12:00:00Z");
const minutes = (n: number) => new Date(T.getTime() + n * 60_000);

// The pagination test asserts on the whole table's query result at now=T2,
// so T2 must be a time window nothing else can share: a random far-past day
// (1971–1999) drawn per run. Real posts never predate the blog, the
// visibility-matrix posts sit at T (2026), and concurrent or crashed runs
// draw their own day.
const T2 = new Date(
  Date.UTC(1971, 0, 1, 12) + Math.floor(Math.random() * 29 * 365) * 86_400_000,
);
const t2Minutes = (n: number) => new Date(T2.getTime() + n * 60_000);

const userId = `user-${runId}`;

let categoryId: number;
let tagAlphaId: number;
let tagBetaId: number;

const slugs = {
  publishedVisible: `${runId}-published-visible`,
  draft: `${runId}-draft`,
  scheduledFuture: `${runId}-scheduled-future`,
  archivedPast: `${runId}-archived-past`,
  archiveFuture: `${runId}-archive-future`,
  statusArchived: `${runId}-status-archived`,
  detailTagged: `${runId}-detail-tagged`,
  detailUntagged: `${runId}-detail-untagged`,
  list1: `${runId}-list-1`,
  list2: `${runId}-list-2`,
  list3: `${runId}-list-3`,
  list4: `${runId}-list-4`,
  list5: `${runId}-list-5`,
  unknown: `${runId}-does-not-exist`,
};

function basePost(overrides: {
  slug: string;
  status: "draft" | "scheduled" | "published" | "archived";
  publishAt: Date | null;
  archiveAt?: Date | null;
}) {
  return {
    authorId: userId,
    categoryId,
    title: `Post ${overrides.slug}`,
    bodyMd: "Body text.",
    thumbnailUrl: "https://example.com/thumb.jpg",
    commentsLocked: false,
    ...overrides,
  };
}

beforeAll(async () => {
  // Hygiene sweep of leftovers from runs that died before afterAll. Age-gated
  // (and, for tags/categories, reference-gated) so a concurrent run's fresh
  // rows in the shared local database are never touched; assertions don't
  // depend on this sweep — isolation comes from runId slugs and the random T2.
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000);
  await testDb
    .delete(posts)
    .where(
      and(
        like(posts.slug, `${SEED_PREFIX}%`),
        lt(posts.createdAt, staleBefore),
      ),
    );
  await testDb.delete(tags).where(
    and(
      like(tags.slug, `tag-%${SEED_PREFIX}%`),
      notExists(
        testDb
          .select({ one: sql`1` })
          .from(postTags)
          .where(eq(postTags.tagId, tags.id)),
      ),
    ),
  );
  await testDb.delete(categories).where(
    and(
      like(categories.slug, `cat-${SEED_PREFIX}%`),
      notExists(
        testDb
          .select({ one: sql`1` })
          .from(posts)
          .where(eq(posts.categoryId, categories.id)),
      ),
    ),
  );
  await testDb
    .delete(user)
    .where(
      and(
        like(user.id, `user-${SEED_PREFIX}%`),
        lt(user.createdAt, staleBefore),
      ),
    );

  await testDb.insert(user).values({
    id: userId,
    name: `Test Author ${runId}`,
    email: `test-${runId}@example.com`,
  });

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;

  const [tagAlpha] = await testDb
    .insert(tags)
    .values({ slug: `tag-alpha-${runId}`, name: `Alpha Tag ${runId}` })
    .returning({ id: tags.id });
  tagAlphaId = tagAlpha!.id;

  const [tagBeta] = await testDb
    .insert(tags)
    .values({ slug: `tag-beta-${runId}`, name: `Beta Tag ${runId}` })
    .returning({ id: tags.id });
  tagBetaId = tagBeta!.id;

  const [detailTagged] = await testDb
    .insert(posts)
    .values({
      ...basePost({
        slug: slugs.detailTagged,
        status: "published",
        publishAt: minutes(-5),
      }),
      bannerUrl: "https://example.com/banner.jpg",
    })
    .returning({ id: posts.id });

  // Insert in reverse alphabetical order so the tags assertion actually
  // exercises the `order by name` in the aggregation, not insertion order.
  await testDb.insert(postTags).values([
    { postId: detailTagged!.id, tagId: tagBetaId },
    { postId: detailTagged!.id, tagId: tagAlphaId },
  ]);

  await testDb.insert(posts).values([
    basePost({
      slug: slugs.publishedVisible,
      status: "published",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.draft,
      status: "draft",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.scheduledFuture,
      status: "scheduled",
      publishAt: minutes(60),
    }),
    basePost({
      slug: slugs.archivedPast,
      status: "published",
      publishAt: minutes(-120),
      archiveAt: minutes(-60),
    }),
    basePost({
      slug: slugs.archiveFuture,
      status: "published",
      publishAt: minutes(-120),
      archiveAt: minutes(60),
    }),
    basePost({
      slug: slugs.statusArchived,
      status: "archived",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.detailUntagged,
      status: "published",
      publishAt: minutes(-6),
    }),
    basePost({
      slug: slugs.list1,
      status: "published",
      publishAt: t2Minutes(-10),
    }),
    basePost({
      slug: slugs.list2,
      status: "published",
      publishAt: t2Minutes(-20),
    }),
    basePost({
      slug: slugs.list3,
      status: "published",
      publishAt: t2Minutes(-30),
    }),
    basePost({
      slug: slugs.list4,
      status: "published",
      publishAt: t2Minutes(-40),
    }),
    basePost({
      slug: slugs.list5,
      status: "published",
      publishAt: t2Minutes(-50),
    }),
  ]);
});

afterAll(async () => {
  // This run's rows only (runId is unique per run) — concurrent-run safe.
  // posts -> postTags cascades on delete; delete the rest in FK order.
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(tags).where(inArray(tags.id, [tagAlphaId, tagBetaId]));
  await testDb.delete(categories).where(inArray(categories.id, [categoryId]));
  await testDb.delete(user).where(inArray(user.id, [userId]));
  await pool.end();
});

describe("visiblePostsWhere / getVisiblePostBySlug", () => {
  it("shows a published post with publishAt in the past and no archiveAt", async () => {
    const post = await getVisiblePostBySlug(slugs.publishedVisible, T);
    expect(post?.slug).toBe(slugs.publishedVisible);
  });

  it("hides a draft post", async () => {
    const post = await getVisiblePostBySlug(slugs.draft, T);
    expect(post).toBeNull();
  });

  it("hides a scheduled post before publishAt, shows it once now passes publishAt", async () => {
    const before = await getVisiblePostBySlug(slugs.scheduledFuture, T);
    expect(before).toBeNull();

    const after = await getVisiblePostBySlug(
      slugs.scheduledFuture,
      minutes(61),
    );
    expect(after?.slug).toBe(slugs.scheduledFuture);
  });

  it("hides a published post once past its archiveAt, shows it before archiveAt", async () => {
    const archived = await getVisiblePostBySlug(slugs.archivedPast, T);
    expect(archived).toBeNull();

    const notYetArchived = await getVisiblePostBySlug(slugs.archiveFuture, T);
    expect(notYetArchived?.slug).toBe(slugs.archiveFuture);
  });

  it("hides a post with status 'archived' regardless of dates", async () => {
    const post = await getVisiblePostBySlug(slugs.statusArchived, T);
    expect(post).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    const post = await getVisiblePostBySlug(slugs.unknown, T);
    expect(post).toBeNull();
  });

  it("aggregates tags ordered by name, and returns [] with no tags", async () => {
    const tagged = await getVisiblePostBySlug(slugs.detailTagged, T);
    expect(tagged?.tags).toEqual([
      { slug: `tag-alpha-${runId}`, name: `Alpha Tag ${runId}` },
      { slug: `tag-beta-${runId}`, name: `Beta Tag ${runId}` },
    ]);

    const untagged = await getVisiblePostBySlug(slugs.detailUntagged, T);
    expect(untagged?.tags).toEqual([]);
  });

  it("returns bannerUrl when set and null when absent (POST-9)", async () => {
    const withBanner = await getVisiblePostBySlug(slugs.detailTagged, T);
    expect(withBanner?.bannerUrl).toBe("https://example.com/banner.jpg");

    const withoutBanner = await getVisiblePostBySlug(slugs.detailUntagged, T);
    expect(withoutBanner?.bannerUrl).toBeNull();
  });

  it("includes category and author details", async () => {
    const post = await getVisiblePostBySlug(slugs.publishedVisible, T);
    expect(post?.category).toEqual({
      slug: `cat-${runId}`,
      name: `Category ${runId}`,
    });
    expect(post?.author.name).toBe(`Test Author ${runId}`);
  });
});

describe("listVisiblePosts", () => {
  it("orders by publishAt desc, paginates with hasMore, and includes card fields", async () => {
    const page1 = await listVisiblePosts({ now: T2, limit: 3 });
    expect(page1.posts.map((p) => p.slug)).toEqual([
      slugs.list1,
      slugs.list2,
      slugs.list3,
    ]);
    expect(page1.hasMore).toBe(true);

    const page2 = await listVisiblePosts({ now: T2, limit: 3, offset: 3 });
    expect(page2.posts.map((p) => p.slug)).toEqual([slugs.list4, slugs.list5]);
    expect(page2.hasMore).toBe(false);

    const full = await listVisiblePosts({ now: T2, limit: 5 });
    expect(full.posts.map((p) => p.slug)).toEqual([
      slugs.list1,
      slugs.list2,
      slugs.list3,
      slugs.list4,
      slugs.list5,
    ]);
    expect(full.hasMore).toBe(false);

    const [card] = full.posts;
    expect(card?.category).toEqual({
      slug: `cat-${runId}`,
      name: `Category ${runId}`,
    });
    expect(card?.author.name).toBe(`Test Author ${runId}`);
    expect(card?.excerptSource).toBe("Body text.");
    expect(card?.publishAt).toBeInstanceOf(Date);
  });
});
