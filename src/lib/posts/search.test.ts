import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sweepStalePostFixtures } from "@/test/helpers";

// Same DB-backed harness as the other lib tests (vi.hoisted pool + mocked
// "@/db"); search.ts's real queries run against it.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { SNIPPET_START, SNIPPET_END, searchVisiblePosts } =
  await import("./search");

const { categories, posts, postTags, tags, user } = schema;

// Fixed marker on every seeded row so a crashed run's leftovers can be swept
// in beforeAll; the per-run id keeps rows (and search terms) unique within a
// run. Search reads the whole visible-posts table (no runId scoping in the
// query itself), so every seeded title/body/tag/category term below is a
// deliberately nonsense word unlikely to collide with real or concurrent-run
// content.
const SEED_PREFIX = "t-search-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}`;

const T = new Date("2026-02-01T12:00:00Z");
const minutes = (n: number) => new Date(T.getTime() + n * 60_000);

const catMainSlug = `cat-${runId}`;
const catAltSlug = `cat-${runId}-alt`;
const catNamedSlug = `cat-${runId}-named`;
const catPercentSlug = `cat-${runId}-percent`;
const catVisNamedSlug = `cat-${runId}-vis-named`;

const TITLE_WORD = "zzyzxtitle";
const BODY_WORD = "wibblebody";
const TAG_WORD = "flibbertag";
const CATEGORY_WORD = "zorbicat";
const RANK_WORD = "qwyjibo";
const VISIBILITY_WORD = "plughword";
const VISIBILITY_TAG_WORD = "gribblesnort";
const VISIBILITY_CATEGORY_WORD = "thwompcat";
const PAGINATE_WORD = "snorlaxword";

let categoryMainId: number;
let categoryAltId: number;
let categoryNamedId: number;
let categoryPercentId: number;
let categoryVisNamedId: number;
let tagId: number;
let visTagId: number;

const slugs = {
  titleMatch: `${runId}-title-match`,
  bodyMatch: `${runId}-body-match`,
  tagMatch: `${runId}-tag-match`,
  categoryMatch: `${runId}-category-match`,
  percentDecoy: `${runId}-percent-decoy`,
  rankTitle: `${runId}-rank-title`,
  rankBody: `${runId}-rank-body`,
  visDraft: `${runId}-vis-draft`,
  visArchived: `${runId}-vis-archived`,
  visFuture: `${runId}-vis-future`,
  visDraftTagOnly: `${runId}-vis-draft-tag-only`,
  visDraftCategoryOnly: `${runId}-vis-draft-category-only`,
  pg1: `${runId}-pg-1`,
  pg2: `${runId}-pg-2`,
  pg3: `${runId}-pg-3`,
  pg4: `${runId}-pg-4`,
  pg5: `${runId}-pg-5`,
};

function basePost(overrides: {
  slug: string;
  title: string;
  bodyMd?: string;
  categoryId: number;
  status: "draft" | "scheduled" | "published" | "archived";
  publishAt: Date | null;
}) {
  return {
    authorId,
    thumbnailUrl: "https://example.com/thumb.jpg",
    bodyMd: "Body text.",
    ...overrides,
  };
}

beforeAll(async () => {
  // Hygiene sweep of leftovers from runs that died before afterAll. Age-gated
  // (and reference-gated for tags/categories) so a concurrent run's fresh
  // rows are never touched; assertions don't depend on this sweep — isolation
  // comes from runId-derived slugs and nonsense search terms.
  await sweepStalePostFixtures(testDb, {
    seedPrefix: SEED_PREFIX,
    tagSlugPattern: `tag-%${SEED_PREFIX}%`,
  });

  await testDb.insert(user).values({
    id: authorId,
    name: `Test Author ${runId}`,
    email: `author-${runId}@example.com`,
  });

  const [catMain, catAlt, catNamed, catPercent, catVisNamed] = await testDb
    .insert(categories)
    .values([
      { slug: catMainSlug, name: `Category ${runId}` },
      { slug: catAltSlug, name: `Category Alt ${runId}` },
      { slug: catNamedSlug, name: `${CATEGORY_WORD} ${runId}` },
      { slug: catPercentSlug, name: `Value100X ${runId}` },
      { slug: catVisNamedSlug, name: `${VISIBILITY_CATEGORY_WORD} ${runId}` },
    ])
    .returning({ id: categories.id });
  categoryMainId = catMain!.id;
  categoryAltId = catAlt!.id;
  categoryNamedId = catNamed!.id;
  categoryPercentId = catPercent!.id;
  categoryVisNamedId = catVisNamed!.id;

  const [tag, visTag] = await testDb
    .insert(tags)
    .values([
      { slug: `tag-${runId}`, name: `${TAG_WORD} ${runId}` },
      {
        slug: `tag-${runId}-vis`,
        name: `${VISIBILITY_TAG_WORD} ${runId}`,
      },
    ])
    .returning({ id: tags.id });
  tagId = tag!.id;
  visTagId = visTag!.id;

  const [taggedPost] = await testDb
    .insert(posts)
    .values(
      basePost({
        slug: slugs.tagMatch,
        title: `${runId} tag-match`,
        categoryId: categoryMainId,
        status: "published",
        publishAt: minutes(-5),
      }),
    )
    .returning({ id: posts.id });
  await testDb.insert(postTags).values({ postId: taggedPost!.id, tagId });

  const [visDraftTagOnlyPost] = await testDb
    .insert(posts)
    .values(
      basePost({
        slug: slugs.visDraftTagOnly,
        title: `${runId} vis-draft-tag-only`,
        categoryId: categoryMainId,
        status: "draft",
        publishAt: minutes(-60),
      }),
    )
    .returning({ id: posts.id });
  await testDb
    .insert(postTags)
    .values({ postId: visDraftTagOnlyPost!.id, tagId: visTagId });

  await testDb.insert(posts).values([
    basePost({
      slug: slugs.titleMatch,
      title: `${runId} ${TITLE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.bodyMatch,
      title: `${runId} body-match`,
      bodyMd: `Intro sentence unrelated to anything at all. This paragraph contains ${BODY_WORD} right here in the middle for headline testing purposes. A trailing sentence follows after that too.`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.categoryMatch,
      title: `${runId} category-match`,
      categoryId: categoryNamedId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.percentDecoy,
      title: `${runId} percent-decoy`,
      categoryId: categoryPercentId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.rankTitle,
      title: `${runId} ${RANK_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.rankBody,
      title: `${runId} rank-body`,
      bodyMd: `This post's body mentions ${RANK_WORD} only in the body, never in the title.`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-5),
    }),
    basePost({
      slug: slugs.visDraft,
      title: `${runId} ${VISIBILITY_WORD}`,
      categoryId: categoryMainId,
      status: "draft",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.visArchived,
      title: `${runId} ${VISIBILITY_WORD}`,
      categoryId: categoryMainId,
      status: "archived",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.visFuture,
      title: `${runId} ${VISIBILITY_WORD}`,
      categoryId: categoryMainId,
      status: "scheduled",
      publishAt: minutes(60),
    }),
    basePost({
      slug: slugs.visDraftCategoryOnly,
      title: `${runId} vis-draft-category-only`,
      categoryId: categoryVisNamedId,
      status: "draft",
      publishAt: minutes(-60),
    }),
    basePost({
      slug: slugs.pg1,
      title: `${runId} ${PAGINATE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-10),
    }),
    basePost({
      slug: slugs.pg2,
      title: `${runId} ${PAGINATE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-20),
    }),
    basePost({
      slug: slugs.pg3,
      title: `${runId} ${PAGINATE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-30),
    }),
    basePost({
      slug: slugs.pg4,
      title: `${runId} ${PAGINATE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-40),
    }),
    basePost({
      slug: slugs.pg5,
      title: `${runId} ${PAGINATE_WORD}`,
      categoryId: categoryMainId,
      status: "published",
      publishAt: minutes(-50),
    }),
  ]);
});

afterAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(tags).where(like(tags.slug, `tag-${runId}%`));
  await testDb
    .delete(categories)
    .where(
      inArray(categories.id, [
        categoryMainId,
        categoryAltId,
        categoryNamedId,
        categoryPercentId,
        categoryVisNamedId,
      ]),
    );
  await testDb.delete(user).where(inArray(user.id, [authorId]));
  await pool.end();
});

describe("searchVisiblePosts", () => {
  it("matches on title", async () => {
    const { results } = await searchVisiblePosts({ q: TITLE_WORD, now: T });
    expect(results.map((r) => r.slug)).toContain(slugs.titleMatch);
  });

  it("matches on body, and returns a snippet wrapped in the marker tokens", async () => {
    const { results } = await searchVisiblePosts({ q: BODY_WORD, now: T });
    const match = results.find((r) => r.slug === slugs.bodyMatch);
    expect(match).toBeDefined();
    expect(match!.snippet).toContain(SNIPPET_START);
    expect(match!.snippet).toContain(SNIPPET_END);
    const startIdx = match!.snippet.indexOf(SNIPPET_START);
    const endIdx = match!.snippet.indexOf(SNIPPET_END);
    const highlighted = match!.snippet.slice(
      startIdx + SNIPPET_START.length,
      endIdx,
    );
    expect(highlighted.toLowerCase()).toContain(BODY_WORD);
  });

  it("matches on tag name", async () => {
    const { results } = await searchVisiblePosts({ q: TAG_WORD, now: T });
    expect(results.map((r) => r.slug)).toContain(slugs.tagMatch);
  });

  it("matches on category name", async () => {
    const { results } = await searchVisiblePosts({
      q: CATEGORY_WORD,
      now: T,
    });
    const match = results.find((r) => r.slug === slugs.categoryMatch);
    expect(match).toBeDefined();
    expect(match!.category).toEqual({
      slug: catNamedSlug,
      name: `${CATEGORY_WORD} ${runId}`,
    });
  });

  it("combines with a category filter: excludes when categorySlug doesn't match, includes when it does", async () => {
    const filteredOut = await searchVisiblePosts({
      q: TITLE_WORD,
      categorySlug: catAltSlug,
      now: T,
    });
    expect(filteredOut.results.map((r) => r.slug)).not.toContain(
      slugs.titleMatch,
    );

    const filteredIn = await searchVisiblePosts({
      q: TITLE_WORD,
      categorySlug: catMainSlug,
      now: T,
    });
    expect(filteredIn.results.map((r) => r.slug)).toContain(slugs.titleMatch);
  });

  it("never returns a draft, archived, or not-yet-published post even on an exact title match", async () => {
    const { results } = await searchVisiblePosts({
      q: VISIBILITY_WORD,
      now: T,
    });
    expect(results).toEqual([]);
  });

  it("never returns a non-visible post whose only match is its tag name", async () => {
    const { results } = await searchVisiblePosts({
      q: VISIBILITY_TAG_WORD,
      now: T,
    });
    expect(results.map((r) => r.slug)).not.toContain(slugs.visDraftTagOnly);
  });

  it("never returns a non-visible post whose only match is its category name", async () => {
    const { results } = await searchVisiblePosts({
      q: VISIBILITY_CATEGORY_WORD,
      now: T,
    });
    expect(results.map((r) => r.slug)).not.toContain(
      slugs.visDraftCategoryOnly,
    );
  });

  it("ranks a title-word match above a body-only match for the same query", async () => {
    const { results } = await searchVisiblePosts({
      q: RANK_WORD,
      categorySlug: catMainSlug,
      now: T,
    });
    const titleIdx = results.findIndex((r) => r.slug === slugs.rankTitle);
    const bodyIdx = results.findIndex((r) => r.slug === slugs.rankBody);
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(bodyIdx);
  });

  it("returns [] without a DB round trip for an empty/whitespace query", async () => {
    const selectSpy = vi.spyOn(testDb, "select");
    const result = await searchVisiblePosts({ q: "   " });
    expect(result).toEqual({ results: [], hasMore: false });
    expect(selectSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
  });

  it("paginates: limit+1 drives hasMore, offset advances", async () => {
    const page1 = await searchVisiblePosts({
      q: PAGINATE_WORD,
      categorySlug: catMainSlug,
      now: T,
      limit: 3,
    });
    expect(page1.results.map((r) => r.slug)).toEqual([
      slugs.pg1,
      slugs.pg2,
      slugs.pg3,
    ]);
    expect(page1.hasMore).toBe(true);

    const page2 = await searchVisiblePosts({
      q: PAGINATE_WORD,
      categorySlug: catMainSlug,
      now: T,
      limit: 3,
      offset: 3,
    });
    expect(page2.results.map((r) => r.slug)).toEqual([slugs.pg4, slugs.pg5]);
    expect(page2.hasMore).toBe(false);
  });

  it("escapes ILIKE metacharacters instead of over-matching", async () => {
    await expect(
      searchVisiblePosts({ q: "100%", now: T }),
    ).resolves.not.toThrow();
    const { results } = await searchVisiblePosts({ q: "100%", now: T });
    // "Value100X" contains "100" but not the literal "100%" substring — an
    // unescaped % would wildcard-match it (over-match); escaped, it must not.
    expect(results.map((r) => r.slug)).not.toContain(slugs.percentDecoy);
  });
});
