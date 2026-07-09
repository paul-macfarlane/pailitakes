import { and, eq, inArray, like, lt, notExists, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { slugifyTitle } from "@/lib/post-input";

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// same pattern as src/lib/posts.test.ts: one pool/db serves both the mocked
// "@/db" (used by the actions under test) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
});

vi.mock("@/db", () => ({ db: testDb }));

// Settable fake session — tests flip `sessionMock.current` per case instead
// of re-mocking. requireStaff is exported alongside getSession because
// src/lib/session.ts exports both; the actions under test only call
// getSession, so requireStaff throwing if ever invoked is a deliberate
// tripwire, not a real implementation.
const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/session", () => ({
  getSession: async () => sessionMock.current,
  requireStaff: async () => {
    throw new Error("requireStaff is unmocked — actions must use getSession");
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const {
  createPost,
  updatePost,
  deletePost,
  transitionPostStatus,
  schedulePublish,
  scheduleArchive,
  cancelScheduledArchive,
} = await import("./posts");
const { revalidateTag } = await import("next/cache");

const { categories, posts, postTags, tags, user } = schema;

const SEED_PREFIX = "t-adm3-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const authorId = `user-${runId}-author`;
const adminId = `user-${runId}-admin`;
const readerId = `user-${runId}-reader`;

let categoryId: number;

function authorSession() {
  sessionMock.current = {
    user: { id: authorId, role: "author", bannedAt: null },
  };
}
function adminSession() {
  sessionMock.current = {
    user: { id: adminId, role: "admin", bannedAt: null },
  };
}
function readerSession() {
  sessionMock.current = {
    user: { id: readerId, role: "reader", bannedAt: null },
  };
}
function noSession() {
  sessionMock.current = null;
}

beforeAll(async () => {
  // Hygiene sweep of leftovers from runs that died before afterAll. Age-
  // gated (and, for tags/categories, reference-gated — neither table has a
  // createdAt column) so a concurrent run's fresh rows are never touched;
  // same pattern as src/lib/posts.test.ts.
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
      id: adminId,
      name: `Test Admin ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
    },
    {
      id: readerId,
      name: `Test Reader ${runId}`,
      email: `reader-${runId}@example.com`,
      role: "reader",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;
});

afterAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(tags).where(like(tags.slug, `${runId}%`));
  await testDb.delete(categories).where(inArray(categories.id, [categoryId]));
  await testDb
    .delete(user)
    .where(inArray(user.id, [authorId, adminId, readerId]));
  await pool.end();
});

describe("createPost", () => {
  it("creates a draft post as an author, deriving the slug and attaching tags", async () => {
    authorSession();
    const title = `${runId} create basic`;

    const result = await createPost({
      title,
      bodyMd: "Body text.",
      categoryId,
      tags: [`${runId}-tag-one`, `${runId}-tag-two`],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, result.data.id));
    expect(row?.status).toBe("draft");
    expect(row?.authorId).toBe(authorId);
    expect(row?.slug).toBe(slugifyTitle(title));

    const attached = await testDb
      .select({ name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, result.data.id));
    expect(attached.map((t) => t.name).sort()).toEqual(
      [`${runId}-tag-one`, `${runId}-tag-two`].sort(),
    );
  });

  it("retries with a suffixed slug on a duplicate title/slug", async () => {
    authorSession();
    const title = `${runId} duplicate title`;

    const first = await createPost({ title, bodyMd: "Body", categoryId });
    expect(first.ok).toBe(true);

    const second = await createPost({ title, bodyMd: "Body", categoryId });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.slug).not.toBe(first.data.slug);
    expect(second.data.slug.startsWith(`${slugifyTitle(title)}-`)).toBe(true);
    // The retry suffix must never push the slug past the 80-char cap that
    // postUpdateSchema enforces on every later editor round-trip.
    expect(second.data.slug.length).toBeLessThanOrEqual(80);
    expect(second.data.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("keeps the retried slug within the 80-character cap when the base slug is already near it", async () => {
    authorSession();
    // slugifyTitle truncates to 80 chars, so a long-enough title pins the
    // derived base slug well past the 73-char retry-truncation threshold —
    // without that truncation, appending the "-" + 6-char suffix would
    // overflow the 80-char column/schema cap.
    const title = `${runId} ${"word ".repeat(30).trim()}`;
    const base = slugifyTitle(title);
    expect(base.length).toBeGreaterThan(73);

    const first = await createPost({ title, bodyMd: "Body", categoryId });
    expect(first.ok).toBe(true);

    const second = await createPost({ title, bodyMd: "Body", categoryId });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.slug).not.toBe(first.data.slug);
    expect(second.data.slug.length).toBeLessThanOrEqual(80);
    expect(second.data.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("returns 'That slug is taken.' instead of retrying when an EXPLICIT slug collides", async () => {
    authorSession();
    const slug = `${runId}-explicit-slug`;

    const first = await createPost({
      title: `${runId} explicit slug first`,
      slug,
      bodyMd: "Body",
      categoryId,
    });
    expect(first.ok).toBe(true);

    // The author picked this slug on purpose — no silent "-xxxxxx" suffix.
    const second = await createPost({
      title: `${runId} explicit slug second`,
      slug,
      bodyMd: "Body",
      categoryId,
    });
    expect(second).toEqual({ ok: false, error: "That slug is taken." });
  });

  it("rejects a reader or unauthenticated caller, creating no row", async () => {
    readerSession();
    const readerResult = await createPost({
      title: `${runId} reader attempt`,
      bodyMd: "Body",
      categoryId,
    });
    expect(readerResult).toEqual({ ok: false, error: "Not authorized." });

    noSession();
    const noSessionResult = await createPost({
      title: `${runId} no session attempt`,
      bodyMd: "Body",
      categoryId,
    });
    expect(noSessionResult).toEqual({ ok: false, error: "Not authorized." });

    const rows = await testDb
      .select({ id: posts.id })
      .from(posts)
      .where(like(posts.slug, `${runId}-reader-attempt%`));
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid input (non-https thumbnail)", async () => {
    authorSession();
    const result = await createPost({
      title: `${runId} bad thumbnail`,
      bodyMd: "Body",
      categoryId,
      thumbnailUrl: "http://example.com/thumb.jpg",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown categoryId", async () => {
    authorSession();
    const result = await createPost({
      title: `${runId} unknown category`,
      bodyMd: "Body",
      categoryId: 999_999_999,
    });
    expect(result).toEqual({ ok: false, error: "Unknown category." });
  });
});

describe("updatePost", () => {
  async function seedPost(slugSuffix: string) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} ${slugSuffix}`,
        slug: `${runId}-${slugSuffix}`,
        bodyMd: "Original body.",
        thumbnailUrl: "",
        categoryId,
      })
      .returning({ id: posts.id, slug: posts.slug });
    return row!;
  }

  it("rejects a non-owner author but allows an admin", async () => {
    const post = await seedPost("owner-check");

    // A non-owner AUTHOR (not a reader): passes the staff gate, fails the
    // ownership check.
    sessionMock.current = {
      user: { id: readerId, role: "author", bannedAt: null },
    };
    const nonOwnerResult = await updatePost(post.id, { title: "New title" });
    expect(nonOwnerResult).toEqual({ ok: false, error: "Not authorized." });

    adminSession();
    const adminResult = await updatePost(post.id, { title: "New title" });
    expect(adminResult.ok).toBe(true);
  });

  it("replaces the tag set and revalidates post-list and the post tag", async () => {
    const post = await seedPost("tag-replace");
    authorSession();

    const first = await updatePost(post.id, {
      tags: [`${runId}-tag-old`],
    });
    expect(first.ok).toBe(true);

    vi.mocked(revalidateTag).mockClear();

    const second = await updatePost(post.id, {
      tags: [`${runId}-tag-new`],
    });
    expect(second.ok).toBe(true);

    const attached = await testDb
      .select({ name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, post.id));
    expect(attached.map((t) => t.name)).toEqual([`${runId}-tag-new`]);

    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${post.slug}`,
      expect.anything(),
    );
  });

  it("revalidates both the old and new slug tags when the slug changes", async () => {
    const post = await seedPost("slug-change");
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const newSlug = `${runId}-slug-change-renamed`;
    const result = await updatePost(post.id, { slug: newSlug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).toBe(newSlug);

    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${newSlug}`,
      expect.anything(),
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${post.slug}`,
      expect.anything(),
    );
  });

  it("bumps updatedAt on a tags-only update, even though no post columns change", async () => {
    const post = await seedPost("updated-at-bump");
    authorSession();

    // Pin updatedAt far in the past instead of comparing DB-clock (seed
    // defaultNow) against app-clock (the action's new Date()) — a database
    // whose clock runs slightly ahead of the test process would otherwise
    // make this flaky.
    const past = new Date("2020-01-01T00:00:00Z");
    await testDb
      .update(posts)
      .set({ updatedAt: past })
      .where(eq(posts.id, post.id));

    const result = await updatePost(post.id, {
      tags: [`${runId}-updated-at-tag`],
    });
    expect(result.ok).toBe(true);

    const [after] = await testDb
      .select({ updatedAt: posts.updatedAt })
      .from(posts)
      .where(eq(posts.id, post.id));

    expect(after!.updatedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it("returns 'That slug is taken.' when an explicit slug edit collides", async () => {
    const first = await seedPost("slug-collide-a");
    const second = await seedPost("slug-collide-b");
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await updatePost(second.id, { slug: first.slug });
    expect(result).toEqual({ ok: false, error: "That slug is taken." });

    // The failed save must not have invalidated anything.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("skips the DB write and revalidation entirely on an empty update payload", async () => {
    const post = await seedPost("noop-update");
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const past = new Date("2020-01-01T00:00:00Z");
    await testDb
      .update(posts)
      .set({ updatedAt: past })
      .where(eq(posts.id, post.id));

    const result = await updatePost(post.id, {});
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, slug: post.slug },
    });

    const [after] = await testDb
      .select({ updatedAt: posts.updatedAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(after!.updatedAt.getTime()).toBe(past.getTime());
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("preserves thumbnail/banner/video/tags on a title-only update, but an explicit empty tags array clears tags", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} field preservation`,
        slug: `${runId}-field-preservation`,
        bodyMd: "Original body.",
        thumbnailUrl: "https://example.com/thumb.jpg",
        bannerUrl: "https://example.com/banner.jpg",
        videoUrl: "https://example.com/video.mp4",
        categoryId,
      })
      .returning({ id: posts.id, slug: posts.slug });

    const [tagOne] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-fp-tag-one`, name: `${runId}-fp-tag-one` })
      .returning({ id: tags.id });
    const [tagTwo] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-fp-tag-two`, name: `${runId}-fp-tag-two` })
      .returning({ id: tags.id });
    await testDb.insert(postTags).values([
      { postId: post!.id, tagId: tagOne!.id },
      { postId: post!.id, tagId: tagTwo!.id },
    ]);

    authorSession();

    // This is the regression case for the postUpdateSchema `.partial()`
    // bug: a title-only edit must never touch thumbnail/banner/video or
    // silently drop the tag set just because those keys were absent from
    // the input.
    const result = await updatePost(post!.id, { title: "New title" });
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row?.title).toBe("New title");
    expect(row?.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(row?.bannerUrl).toBe("https://example.com/banner.jpg");
    expect(row?.videoUrl).toBe("https://example.com/video.mp4");

    const attachedAfterTitleUpdate = await testDb
      .select({ tagId: postTags.tagId })
      .from(postTags)
      .where(eq(postTags.postId, post!.id));
    expect(attachedAfterTitleUpdate).toHaveLength(2);

    // An explicit empty array is an intentional edit — unlike an absent
    // `tags` key, it DOES clear the post's tag set.
    const clearResult = await updatePost(post!.id, { tags: [] });
    expect(clearResult.ok).toBe(true);

    const attachedAfterClear = await testDb
      .select()
      .from(postTags)
      .where(eq(postTags.postId, post!.id));
    expect(attachedAfterClear).toHaveLength(0);
  });

  it("refuses to clear the thumbnail of a published post (public-thumbnail invariant)", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} pub-thumb`,
        slug: `${runId}-pub-thumb`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId,
        status: "published",
        publishAt: new Date(Date.now() - 1000),
      })
      .returning({ id: posts.id });
    authorSession();

    const result = await updatePost(post!.id, { thumbnailUrl: "" });
    expect(result).toEqual({
      ok: false,
      error: "A published or scheduled post must keep its thumbnail.",
    });

    // Editing other fields on the same post still works (thumbnail kept).
    const ok = await updatePost(post!.id, { title: `${runId} pub-thumb 2` });
    expect(ok.ok).toBe(true);
  });

  it("allows clearing the thumbnail on a draft (write guard must not over-block)", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} draft-thumb`,
        slug: `${runId}-draft-thumb`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId,
        status: "draft",
      })
      .returning({ id: posts.id });
    authorSession();

    const result = await updatePost(post!.id, { thumbnailUrl: "" });
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ thumbnailUrl: posts.thumbnailUrl })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.thumbnailUrl).toBe("");
  });
});

describe("deletePost", () => {
  it("rejects an author but allows an admin, removing the post and its tags", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} delete target`,
        slug: `${runId}-delete-target`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId,
      })
      .returning({ id: posts.id });

    const [tagRow] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-delete-tag`, name: `${runId}-delete-tag` })
      .returning({ id: tags.id });
    await testDb
      .insert(postTags)
      .values({ postId: post!.id, tagId: tagRow!.id });

    authorSession();
    const authorResult = await deletePost(post!.id);
    expect(authorResult).toEqual({ ok: false, error: "Not authorized." });

    vi.mocked(revalidateTag).mockClear();
    adminSession();
    const adminResult = await deletePost(post!.id);
    expect(adminResult).toEqual({ ok: true, data: { id: post!.id } });

    const remainingPosts = await testDb
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(remainingPosts).toHaveLength(0);

    const remainingPostTags = await testDb
      .select()
      .from(postTags)
      .where(eq(postTags.postId, post!.id));
    expect(remainingPostTags).toHaveLength(0);

    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });
});

describe("transitionPostStatus", () => {
  const HTTPS_THUMB = "https://img.example.com/thumb.jpg";

  async function seedPost(opts: {
    suffix: string;
    status: "draft" | "scheduled" | "published" | "archived";
    thumbnailUrl?: string;
    authorId?: string;
    archiveAt?: Date | null;
  }) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId: opts.authorId ?? authorId,
        title: `${runId} ${opts.suffix}`,
        slug: `${runId}-${opts.suffix}`,
        bodyMd: "Body.",
        thumbnailUrl: opts.thumbnailUrl ?? "",
        categoryId,
        status: opts.status,
        archiveAt: opts.archiveAt ?? null,
      })
      .returning({ id: posts.id, slug: posts.slug });
    return row!;
  }

  it("publishes a draft with a thumbnail: sets published, publish_at, clears archive_at, revalidates", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "publish-ok",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: future,
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "published");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "published" },
    });

    const [row] = await testDb
      .select({
        status: posts.status,
        publishAt: posts.publishAt,
        archiveAt: posts.archiveAt,
      })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("published");
    expect(row!.publishAt).not.toBeNull();
    expect(row!.publishAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row!.archiveAt).toBeNull();

    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${post.slug}`,
      expect.anything(),
    );
  });

  it("blocks publishing a post with no thumbnail (publish-time validation)", async () => {
    const post = await seedPost({
      suffix: "publish-no-thumb",
      status: "draft",
      thumbnailUrl: "",
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "published");
    expect(result).toEqual({
      ok: false,
      error: "Add a thumbnail image before publishing.",
    });

    const [row] = await testDb
      .select({ status: posts.status })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("draft");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("archives a published post and clears a pending scheduled archive_at", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "archive",
      status: "published",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: future,
    });
    authorSession();

    const result = await transitionPostStatus(post.id, "archived");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("archived");
    // The manual archive fulfills the schedule; a stale future archive_at
    // would otherwise trigger a pointless cron revalidation later.
    expect(row!.archiveAt).toBeNull();
  });

  it("restoring an archived post to published preserves its original publish date", async () => {
    // A post published last week, then archived: restoring keeps the date
    // (and feed position), it does not jump to 'now' (FR-1.6).
    const originalPublish = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} restore-published`,
        slug: `${runId}-restore-published`,
        bodyMd: "Body.",
        thumbnailUrl: HTTPS_THUMB,
        categoryId,
        status: "archived",
        publishAt: originalPublish,
      })
      .returning({ id: posts.id });
    authorSession();

    const result = await transitionPostStatus(post!.id, "published");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.status).toBe("published");
    expect(row!.publishAt!.getTime()).toBe(originalPublish.getTime());
  });

  it("restores an archived post to draft, clearing a pending archive_at", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "restore-draft",
      status: "archived",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: past,
    });
    authorSession();

    const result = await transitionPostStatus(post.id, "draft");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "draft" },
    });

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("draft");
    expect(row!.archiveAt).toBeNull();
  });

  it("re-publishing a drafted post stamps now(), not its stale prior publish date", async () => {
    // published -> draft leaves a week-old publish_at on the draft; hitting
    // Publish now must surface it as newly published, not backdated (only an
    // archived-restore preserves the old date).
    const stale = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} republish-draft`,
        slug: `${runId}-republish-draft`,
        bodyMd: "Body.",
        thumbnailUrl: HTTPS_THUMB,
        categoryId,
        status: "draft",
        publishAt: stale,
      })
      .returning({ id: posts.id });
    authorSession();

    const before = Date.now();
    const result = await transitionPostStatus(post!.id, "published");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.publishAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.publishAt!.getTime()).not.toBe(stale.getTime());
  });

  it("rejects a disallowed transition (archived -> archived is caught as no-op; publish->scheduled routed to scheduling)", async () => {
    // 'scheduled' is intercepted before the transition matrix (needs a
    // timestamp), so published->scheduled returns the scheduling hint.
    const scheduledTarget = await seedPost({
      suffix: "bad-transition",
      status: "published",
      thumbnailUrl: HTTPS_THUMB,
    });
    authorSession();
    expect(
      await transitionPostStatus(scheduledTarget.id, "scheduled"),
    ).toEqual({
      ok: false,
      error: "Use schedule publish to set a publish time.",
    });
  });

  it("rejects an unknown target status", async () => {
    const post = await seedPost({ suffix: "bad-status", status: "draft" });
    authorSession();

    const result = await transitionPostStatus(post.id, "deleted");
    expect(result).toEqual({ ok: false, error: "Invalid status." });
  });

  it("is idempotent: transitioning to the current status succeeds without revalidating", async () => {
    const post = await seedPost({ suffix: "idempotent", status: "draft" });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "draft");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "draft" },
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a non-owner author but allows an admin", async () => {
    const post = await seedPost({
      suffix: "status-owner-check",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
    });

    // A different author (staff, but not the owner).
    sessionMock.current = {
      user: { id: readerId, role: "author", bannedAt: null },
    };
    const nonOwner = await transitionPostStatus(post.id, "archived");
    expect(nonOwner).toEqual({ ok: false, error: "Not authorized." });

    adminSession();
    const asAdmin = await transitionPostStatus(post.id, "archived");
    expect(asAdmin.ok).toBe(true);
  });

  it("rejects a reader and an unauthenticated caller", async () => {
    const post = await seedPost({ suffix: "authz", status: "draft" });

    readerSession();
    expect(await transitionPostStatus(post.id, "archived")).toEqual({
      ok: false,
      error: "Not authorized.",
    });

    noSession();
    expect(await transitionPostStatus(post.id, "archived")).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("returns 'Post not found.' for an unknown id", async () => {
    authorSession();
    const result = await transitionPostStatus(
      "00000000-0000-4000-8000-000000000000",
      "archived",
    );
    expect(result).toEqual({ ok: false, error: "Post not found." });
  });

  it("rejects 'scheduled' as a transition target, even on an already-scheduled post", async () => {
    const post = await seedPost({
      suffix: "to-scheduled",
      status: "scheduled",
      thumbnailUrl: HTTPS_THUMB,
      // future publish so it isn't "already live"
    });
    // Give it a future publish_at so it's a normal scheduled post.
    await testDb
      .update(posts)
      .set({ publishAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
      .where(eq(posts.id, post.id));
    authorSession();

    const result = await transitionPostStatus(post.id, "scheduled");
    expect(result).toEqual({
      ok: false,
      error: "Use schedule publish to set a publish time.",
    });
  });

  it("compare-and-swap rejects a stale write when the status changed concurrently", async () => {
    const post = await seedPost({
      suffix: "cas-conflict",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
    });
    authorSession();

    // Hold a row lock so the action reads 'draft' then blocks on its guarded
    // UPDATE; flip the status underneath it and release. The UPDATE's
    // `WHERE status = 'draft'` then matches zero rows -> conflict.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from posts where id = $1 for update", [
        post.id,
      ]);

      const actionPromise = transitionPostStatus(post.id, "published");

      // Deterministic (not a timing guess): wait until the action's guarded
      // UPDATE is actually blocked on our row lock — by then its non-locking
      // SELECT has already read 'draft'. A row-lock wait shows up as an
      // ungranted transactionid/tuple lock in pg_locks.
      for (let i = 0; ; i++) {
        const { rows } = await client.query(
          "select count(*)::int as n from pg_locks where not granted and locktype in ('transactionid','tuple')",
        );
        if (rows[0].n > 0) break;
        if (i >= 400) throw new Error("action UPDATE never blocked on the lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      await client.query("update posts set status = 'archived' where id = $1", [
        post.id,
      ]);
      await client.query("commit");

      expect(await actionPromise).toEqual({
        ok: false,
        error: "This post was changed elsewhere. Reload and try again.",
      });
    } finally {
      client.release();
    }
  });
});

describe("schedulePublish / scheduleArchive / cancelScheduledArchive", () => {
  const HTTPS_THUMB = "https://img.example.com/thumb.jpg";
  const DAY = 24 * 60 * 60 * 1000;

  async function seedPost(opts: {
    suffix: string;
    status: "draft" | "scheduled" | "published" | "archived";
    thumbnailUrl?: string;
    publishAt?: Date | null;
    archiveAt?: Date | null;
  }) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} ${opts.suffix}`,
        slug: `${runId}-${opts.suffix}`,
        bodyMd: "Body.",
        thumbnailUrl: opts.thumbnailUrl ?? HTTPS_THUMB,
        categoryId,
        status: opts.status,
        publishAt: opts.publishAt ?? null,
        archiveAt: opts.archiveAt ?? null,
      })
      .returning({ id: posts.id });
    return row!;
  }

  it("schedules a future publish on a draft: status becomes scheduled with publish_at set", async () => {
    const post = await seedPost({ suffix: "sched-pub", status: "draft" });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const when = new Date(Date.now() + DAY);
    const result = await schedulePublish(post.id, when.toISOString());
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("scheduled");
    expect(row!.publishAt!.getTime()).toBe(when.getTime());
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("rejects a publish time in the past", async () => {
    const post = await seedPost({ suffix: "sched-past", status: "draft" });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() - DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "Publish time must be in the future.",
    });
  });

  it("blocks scheduling a publish with no thumbnail", async () => {
    const post = await seedPost({
      suffix: "sched-no-thumb",
      status: "draft",
      thumbnailUrl: "",
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "Add a thumbnail image before scheduling a publish.",
    });
  });

  it("refuses to reschedule a scheduled post that is already live (publish_at passed)", async () => {
    const post = await seedPost({
      suffix: "sched-live",
      status: "scheduled",
      // publish_at in the past => currently visible via the predicate.
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "This post is already live. Archive it before rescheduling.",
    });

    // The live post's publish_at must be untouched.
    const [row] = await testDb
      .select({ publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.publishAt!.getTime()).toBeLessThan(Date.now());
  });

  it("cannot schedule a publish for a published post", async () => {
    const post = await seedPost({
      suffix: "sched-published",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot schedule");
  });

  it("rejects a publish time at/after a pending scheduled archive", async () => {
    const archiveAt = new Date(Date.now() + DAY);
    const post = await seedPost({
      suffix: "sched-pub-after-archive",
      status: "scheduled",
      publishAt: new Date(Date.now() + 60_000),
      archiveAt,
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(archiveAt.getTime() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("scheduled archive");
  });

  it("schedules a future archive on a published post", async () => {
    const post = await seedPost({
      suffix: "sched-arch",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const when = new Date(Date.now() + DAY);
    const result = await scheduleArchive(post.id, when.toISOString());
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    // Status is untouched — visibility flips only when archive_at passes.
    expect(row!.status).toBe("published");
    expect(row!.archiveAt!.getTime()).toBe(when.getTime());
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("rejects an archive time at/before the publish time", async () => {
    const publishAt = new Date(Date.now() + DAY);
    const post = await seedPost({
      suffix: "arch-before-pub",
      status: "scheduled",
      publishAt,
    });
    authorSession();

    const result = await scheduleArchive(
      post.id,
      new Date(publishAt.getTime() - 60_000).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("after the publish time");
  });

  it("cannot schedule an archive for a draft", async () => {
    const post = await seedPost({ suffix: "arch-draft", status: "draft" });
    authorSession();

    const result = await scheduleArchive(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot schedule an archive");
  });

  it("rejects an invalid date input", async () => {
    const post = await seedPost({ suffix: "bad-date", status: "draft" });
    authorSession();

    const result = await schedulePublish(post.id, "not-a-date");
    expect(result).toEqual({
      ok: false,
      error: "Enter a valid date and time.",
    });
  });

  it("cancels a pending scheduled archive, clearing archive_at", async () => {
    const post = await seedPost({
      suffix: "cancel-arch",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
      archiveAt: new Date(Date.now() + DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await cancelScheduledArchive(post.id);
    expect(result).toEqual({ ok: true, data: { id: post.id } });

    const [row] = await testDb
      .select({ archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.archiveAt).toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("cancel is idempotent when nothing is scheduled (no write, no revalidate)", async () => {
    const post = await seedPost({
      suffix: "cancel-none",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await cancelScheduledArchive(post.id);
    expect(result).toEqual({ ok: true, data: { id: post.id } });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a reader and an unauthenticated caller", async () => {
    const post = await seedPost({ suffix: "sched-authz", status: "draft" });
    const when = new Date(Date.now() + DAY).toISOString();

    readerSession();
    expect(await schedulePublish(post.id, when)).toEqual({
      ok: false,
      error: "Not authorized.",
    });

    noSession();
    expect(await scheduleArchive(post.id, when)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });
});
