import { and, eq, inArray, like, lt, notExists, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

// vi.hoisted lifts this above the mock factory (TDZ otherwise) — same
// pattern as src/lib/posts.test.ts: one pool/db serves both the mocked
// "@/db" (used by admin-posts.ts) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
});

vi.mock("@/db", () => ({ db: testDb }));

const {
  getEditablePost,
  getPostForPreview,
  listAdminPosts,
  listAuthorOptions,
  listCategoryOptions,
} = await import("./admin-posts");

const { categories, posts, postTags, tags, user } = schema;

const SEED_PREFIX = "t-adm2-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const authorId = `user-${runId}-author`;
const otherAuthorId = `user-${runId}-other`;
const adminId = `user-${runId}-admin`;

let activeCategoryId: number;
let inactiveCategoryId: number;
let sortedFirstId: number;
let sortedSecondId: number;

beforeAll(async () => {
  // Hygiene sweep of leftovers from runs that died before afterAll — same
  // pattern as src/lib/posts.test.ts / src/actions/posts.test.ts.
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
      like(tags.slug, `${SEED_PREFIX}%`),
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

  await testDb.insert(user).values([
    {
      id: authorId,
      name: `Test Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "author",
    },
    {
      id: otherAuthorId,
      name: `Test Other Author ${runId}`,
      email: `other-${runId}@example.com`,
      role: "author",
    },
    {
      id: adminId,
      name: `Test Admin ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
    },
  ]);

  const [active] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}-active`, name: `Active ${runId}` })
    .returning({ id: categories.id });
  activeCategoryId = active!.id;

  const [inactive] = await testDb
    .insert(categories)
    .values({
      slug: `cat-${runId}-inactive`,
      name: `Inactive ${runId}`,
      active: false,
    })
    .returning({ id: categories.id });
  inactiveCategoryId = inactive!.id;

  // Sort order is the primary key for listCategoryOptions' ordering; give
  // the "second" one a lower sortOrder so name-only ordering would fail the
  // assertion below.
  const [sortedSecond] = await testDb
    .insert(categories)
    .values({
      slug: `cat-${runId}-sort-b`,
      name: `A Name ${runId}`,
      sortOrder: 2,
    })
    .returning({ id: categories.id });
  sortedSecondId = sortedSecond!.id;

  const [sortedFirst] = await testDb
    .insert(categories)
    .values({
      slug: `cat-${runId}-sort-a`,
      name: `Z Name ${runId}`,
      sortOrder: 1,
    })
    .returning({ id: categories.id });
  sortedFirstId = sortedFirst!.id;
});

afterAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(tags).where(like(tags.slug, `${runId}%`));
  await testDb
    .delete(categories)
    .where(
      inArray(categories.id, [
        activeCategoryId,
        inactiveCategoryId,
        sortedFirstId,
        sortedSecondId,
      ]),
    );
  await testDb
    .delete(user)
    .where(inArray(user.id, [authorId, otherAuthorId, adminId]));
  await pool.end();
});

describe("getEditablePost", () => {
  it("returns the post with its tag names for the owning author", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} owned`,
        slug: `${runId}-owned`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId: activeCategoryId,
      })
      .returning({ id: posts.id });

    const [tagA] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-tag-a`, name: `${runId}-tag-a` })
      .returning({ id: tags.id });
    const [tagB] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-tag-b`, name: `${runId}-tag-b` })
      .returning({ id: tags.id });
    await testDb.insert(postTags).values([
      { postId: post!.id, tagId: tagB!.id },
      { postId: post!.id, tagId: tagA!.id },
    ]);

    const result = await getEditablePost(post!.id, {
      id: authorId,
      role: "author",
    });
    expect(result?.title).toBe(`${runId} owned`);
    expect(result?.tags).toEqual([`${runId}-tag-a`, `${runId}-tag-b`]);
    // A draft carries no schedule (ADM-5 fields).
    expect(result?.publishAt).toBeNull();
    expect(result?.archiveAt).toBeNull();
  });

  it("returns the scheduling timestamps when set", async () => {
    const publishAt = new Date("2030-01-02T03:04:00.000Z");
    const archiveAt = new Date("2030-02-03T04:05:00.000Z");
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} scheduled`,
        slug: `${runId}-scheduled`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId: activeCategoryId,
        status: "scheduled",
        publishAt,
        archiveAt,
      })
      .returning({ id: posts.id });

    const result = await getEditablePost(post!.id, {
      id: authorId,
      role: "author",
    });
    expect(result?.publishAt?.getTime()).toBe(publishAt.getTime());
    expect(result?.archiveAt?.getTime()).toBe(archiveAt.getTime());
  });

  it("returns null for another author's post", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: otherAuthorId,
        title: `${runId} not-mine`,
        slug: `${runId}-not-mine`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId: activeCategoryId,
      })
      .returning({ id: posts.id });

    const result = await getEditablePost(post!.id, {
      id: authorId,
      role: "author",
    });
    expect(result).toBeNull();
  });

  it("returns another author's post for an admin", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: otherAuthorId,
        title: `${runId} admin-view`,
        slug: `${runId}-admin-view`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId: activeCategoryId,
      })
      .returning({ id: posts.id });

    const result = await getEditablePost(post!.id, {
      id: adminId,
      role: "admin",
    });
    expect(result?.title).toBe(`${runId} admin-view`);
    expect(result?.tags).toEqual([]);
  });

  it("returns null for an unknown uuid", async () => {
    const result = await getEditablePost(crypto.randomUUID(), {
      id: authorId,
      role: "author",
    });
    expect(result).toBeNull();
  });
});

describe("getPostForPreview", () => {
  async function seedDraft(suffix: string, ownerId = authorId) {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: ownerId,
        title: `${runId} ${suffix}`,
        slug: `${runId}-${suffix}`,
        bodyMd: "# Draft body",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId: activeCategoryId,
        status: "draft", // deliberately NOT publicly visible
      })
      .returning({ id: posts.id });
    return post!;
  }

  it("returns a non-public (draft) post for its owner, bypassing visibility", async () => {
    const post = await seedDraft("preview-draft");
    const [tag] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-pv-tag`, name: `${runId}-pv-tag` })
      .returning({ id: tags.id });
    await testDb.insert(postTags).values({ postId: post.id, tagId: tag!.id });

    const result = await getPostForPreview(post.id, {
      id: authorId,
      role: "author",
    });
    expect(result?.status).toBe("draft");
    expect(result?.bodyMd).toBe("# Draft body");
    expect(result?.publishAt).toBeNull();
    expect(result?.category.name).toBeTruthy();
    expect(result?.author.name).toBeTruthy();
    expect(result?.tags).toEqual([
      { slug: `${runId}-pv-tag`, name: `${runId}-pv-tag` },
    ]);
  });

  it("returns null for another author's draft, but the admin sees it", async () => {
    const post = await seedDraft("preview-other", otherAuthorId);

    expect(
      await getPostForPreview(post.id, { id: authorId, role: "author" }),
    ).toBeNull();

    const asAdmin = await getPostForPreview(post.id, {
      id: adminId,
      role: "admin",
    });
    expect(asAdmin?.id).toBe(post.id);
  });

  it("returns null for an unknown uuid", async () => {
    const result = await getPostForPreview(crypto.randomUUID(), {
      id: authorId,
      role: "author",
    });
    expect(result).toBeNull();
  });
});

describe("listAdminPosts", () => {
  // Seeded ids for scoped assertions (the DB may hold rows from other tests,
  // so assert on presence/order of these specific ids, not raw counts).
  let ownPublished: string;
  let ownDraft: string;
  let otherPublished: string;

  async function seed(opts: {
    suffix: string;
    ownerId: string;
    status: "draft" | "scheduled" | "published" | "archived";
    categoryId: number;
    publishAt?: Date | null;
    updatedAt?: Date;
  }) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId: opts.ownerId,
        title: `${runId} ${opts.suffix}`,
        slug: `${runId}-la-${opts.suffix}`,
        bodyMd: "b",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId: opts.categoryId,
        status: opts.status,
        publishAt: opts.publishAt ?? null,
      })
      .returning({ id: posts.id });
    if (opts.updatedAt) {
      await testDb
        .update(posts)
        .set({ updatedAt: opts.updatedAt })
        .where(eq(posts.id, row!.id));
    }
    return row!.id;
  }

  beforeAll(async () => {
    ownPublished = await seed({
      suffix: "own-pub",
      ownerId: authorId,
      status: "published",
      categoryId: activeCategoryId,
      publishAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    ownDraft = await seed({
      suffix: "own-draft",
      ownerId: authorId,
      status: "draft",
      categoryId: sortedFirstId, // distinct category for the filter test
      publishAt: null,
      updatedAt: new Date("2026-06-10T00:00:00Z"),
    });
    otherPublished = await seed({
      suffix: "other-pub",
      ownerId: otherAuthorId,
      status: "published",
      categoryId: activeCategoryId,
      publishAt: new Date("2026-05-01T00:00:00Z"),
    });
  });

  it("scopes an author to their own posts", async () => {
    const { rows } = await listAdminPosts({
      user: { id: authorId, role: "author" },
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ownPublished);
    expect(ids).toContain(ownDraft);
    expect(ids).not.toContain(otherPublished);
  });

  it("ignores a non-admin's author filter (security — no widening)", async () => {
    const { rows } = await listAdminPosts({
      user: { id: authorId, role: "author" },
      authorId: otherAuthorId,
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(otherPublished);
    expect(ids).toContain(ownPublished);
  });

  it("lets an admin see all authors' posts and filter by author", async () => {
    const all = await listAdminPosts({
      user: { id: adminId, role: "admin" },
      limit: 100,
    });
    const allIds = all.rows.map((r) => r.id);
    expect(allIds).toContain(ownPublished);
    expect(allIds).toContain(otherPublished);

    const filtered = await listAdminPosts({
      user: { id: adminId, role: "admin" },
      authorId: otherAuthorId,
      limit: 100,
    });
    const filteredIds = filtered.rows.map((r) => r.id);
    expect(filteredIds).toContain(otherPublished);
    expect(filteredIds).not.toContain(ownPublished);
  });

  it("filters by status", async () => {
    const { rows } = await listAdminPosts({
      user: { id: adminId, role: "admin" },
      status: "draft",
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ownDraft);
    expect(ids).not.toContain(ownPublished);
    expect(rows.every((r) => r.status === "draft")).toBe(true);
  });

  it("filters by category", async () => {
    const { rows } = await listAdminPosts({
      user: { id: authorId, role: "author" },
      categoryId: sortedFirstId,
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ownDraft);
    expect(ids).not.toContain(ownPublished);
  });

  it("sorts by publish date with drafts (null) last", async () => {
    const { rows } = await listAdminPosts({
      user: { id: authorId, role: "author" },
      sort: "published",
      limit: 100,
    });
    const mine = rows.filter((r) => [ownPublished, ownDraft].includes(r.id));
    // ownPublished (has a date) must come before ownDraft (null publishAt).
    expect(mine.map((r) => r.id)).toEqual([ownPublished, ownDraft]);
  });

  it("filters by title search, case-insensitively, with LIKE wildcards escaped", async () => {
    // Two titles that differ only where a '%' sits. A naive (unescaped) ILIKE
    // '%a%b%' would match BOTH; the literal-'%' title must be the only match.
    const literalPct = await seed({
      suffix: "a%b",
      ownerId: authorId,
      status: "draft",
      categoryId: activeCategoryId,
    });
    const wildcardBait = await seed({
      suffix: "axxb",
      ownerId: authorId,
      status: "draft",
      categoryId: activeCategoryId,
    });

    // Case-insensitive contains, and '%' treated literally (escaped).
    const { rows } = await listAdminPosts({
      user: { id: authorId, role: "author" },
      q: "A%B",
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(literalPct);
    expect(ids).not.toContain(wildcardBait);
    expect(ids).not.toContain(ownPublished);

    // A blank/whitespace query is a no-op filter (returns the full scope).
    const unfiltered = await listAdminPosts({
      user: { id: authorId, role: "author" },
      q: "   ",
      limit: 100,
    });
    expect(unfiltered.rows.map((r) => r.id)).toContain(ownPublished);
  });

  it("paginates within a scoped category, reporting hasMore", async () => {
    // Dedicated category (sortedSecondId) with exactly two of the author's
    // posts, so pagination is isolated from other tests' seeds.
    const older = await seed({
      suffix: "pg-older",
      ownerId: authorId,
      status: "draft",
      categoryId: sortedSecondId,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = await seed({
      suffix: "pg-newer",
      ownerId: authorId,
      status: "draft",
      categoryId: sortedSecondId,
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const page1 = await listAdminPosts({
      user: { id: authorId, role: "author" },
      categoryId: sortedSecondId,
      sort: "updated",
      limit: 1,
      offset: 0,
    });
    expect(page1.rows.map((r) => r.id)).toEqual([newer]);
    expect(page1.hasMore).toBe(true);

    const page2 = await listAdminPosts({
      user: { id: authorId, role: "author" },
      categoryId: sortedSecondId,
      sort: "updated",
      limit: 1,
      offset: 1,
    });
    expect(page2.rows.map((r) => r.id)).toEqual([older]);
    expect(page2.hasMore).toBe(false);
  });
});

describe("listAuthorOptions", () => {
  it("returns author and admin users, ordered by name, excluding readers", async () => {
    const options = await listAuthorOptions();
    const ids = options.map((o) => o.id);
    expect(ids).toContain(authorId);
    expect(ids).toContain(adminId);
    expect(ids).toContain(otherAuthorId);

    // Assert order on just the seeded (ASCII-named) rows — the full list may
    // include other tests' users whose collation vs JS sort could differ.
    const seededNames = options
      .filter((o) => [authorId, otherAuthorId, adminId].includes(o.id))
      .map((o) => o.name);
    expect(seededNames).toEqual([...seededNames].sort());
  });
});

describe("listCategoryOptions", () => {
  it("excludes inactive categories and orders by sortOrder then name", async () => {
    const options = await listCategoryOptions();
    const ids = options.map((c) => c.id);

    expect(ids).not.toContain(inactiveCategoryId);

    const firstIndex = ids.indexOf(sortedFirstId);
    const secondIndex = ids.indexOf(sortedSecondId);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
  });
});
