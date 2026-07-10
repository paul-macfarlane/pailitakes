import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { slugifyTitle } from "@/lib/posts/input";
import {
  clearStaffFixtures,
  draftRowLoader,
  seedStaffFixtures,
  sessionUser,
  sweepStalePostFixtures,
  type StaffFixtureIds,
} from "@/test/helpers";

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// one pool/db serves both the mocked "@/db" (used by the actions under
// test) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

// Settable fake session — tests flip `sessionMock.current` per case instead
// of re-mocking. requireStaff is exported alongside getSession because
// src/lib/session.ts exports both; the actions under test only call
// getSession, so requireStaff throwing if ever invoked is a deliberate
// tripwire, not a real implementation.
const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
  requireStaff: async () => {
    throw new Error("requireStaff is unmocked — actions must use getSession");
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { createPost, updatePost, deletePost } = await import("./crud");
const { revalidateTag } = await import("next/cache");

const { posts, postTags, tags } = schema;
const loadDraftRow = draftRowLoader(testDb);

const SEED_PREFIX = "t-adm3a-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

let ids: StaffFixtureIds;

function authorSession() {
  sessionMock.current = sessionUser(ids.authorId, "author");
}
function adminSession() {
  sessionMock.current = sessionUser(ids.adminId, "admin");
}
function readerSession() {
  sessionMock.current = sessionUser(ids.readerId, "reader");
}
function noSession() {
  sessionMock.current = null;
}

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });
  ids = await seedStaffFixtures(testDb, runId);
});

afterAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(tags).where(like(tags.slug, `${runId}%`));
  await clearStaffFixtures(testDb, ids);
  await pool.end();
});

describe("createPost", () => {
  it("creates a draft post as an author, deriving the slug and attaching tags", async () => {
    authorSession();
    const title = `${runId} create basic`;

    const result = await createPost({
      title,
      bodyMd: "Body text.",
      categoryId: ids.categoryId,
      tags: [`${runId}-tag-one`, `${runId}-tag-two`],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, result.data.id));
    expect(row?.status).toBe("draft");
    expect(row?.authorId).toBe(ids.authorId);
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

    const first = await createPost({
      title,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
    expect(first.ok).toBe(true);

    const second = await createPost({
      title,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
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

    const first = await createPost({
      title,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
    expect(first.ok).toBe(true);

    const second = await createPost({
      title,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
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
      categoryId: ids.categoryId,
    });
    expect(first.ok).toBe(true);

    // The author picked this slug on purpose — no silent "-xxxxxx" suffix.
    const second = await createPost({
      title: `${runId} explicit slug second`,
      slug,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
    expect(second).toEqual({ ok: false, error: "That slug is taken." });
  });

  it("rejects a reader or unauthenticated caller, creating no row", async () => {
    readerSession();
    const readerResult = await createPost({
      title: `${runId} reader attempt`,
      bodyMd: "Body",
      categoryId: ids.categoryId,
    });
    expect(readerResult).toEqual({ ok: false, error: "Not authorized." });

    noSession();
    const noSessionResult = await createPost({
      title: `${runId} no session attempt`,
      bodyMd: "Body",
      categoryId: ids.categoryId,
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
      categoryId: ids.categoryId,
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
        authorId: ids.authorId,
        title: `${runId} ${slugSuffix}`,
        slug: `${runId}-${slugSuffix}`,
        bodyMd: "Original body.",
        thumbnailUrl: "",
        categoryId: ids.categoryId,
      })
      .returning({ id: posts.id, slug: posts.slug });
    return row!;
  }

  it("rejects a non-owner author but allows an admin", async () => {
    const post = await seedPost("owner-check");

    // A non-owner AUTHOR (not a reader): passes the staff gate, fails the
    // ownership check.
    sessionMock.current = sessionUser(ids.readerId, "author");
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
        authorId: ids.authorId,
        title: `${runId} field preservation`,
        slug: `${runId}-field-preservation`,
        bodyMd: "Original body.",
        thumbnailUrl: "https://example.com/thumb.jpg",
        bannerUrl: "https://example.com/banner.jpg",
        videoUrl: "https://example.com/video.mp4",
        categoryId: ids.categoryId,
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
        authorId: ids.authorId,
        title: `${runId} pub-thumb`,
        slug: `${runId}-pub-thumb`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId: ids.categoryId,
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
        authorId: ids.authorId,
        title: `${runId} draft-thumb`,
        slug: `${runId}-draft-thumb`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId: ids.categoryId,
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

// Staging behavior lives in updatePostService (src/lib/posts/service/crud.ts)
// — see src/actions/posts/draft.test.ts for publishPostChanges/
// discardPostChanges (promoting/discarding the buffer) and
// src/actions/posts/lifecycle.test.ts for the pending-changes lifecycle
// guard. These cases only ever call updatePost itself, so they stay here.
describe("staged draft edits (draft-of-published, ADR-0011)", () => {
  async function seedPublished(suffix: string) {
    const [row] = await testDb
      .insert(posts)
      .values({
        authorId: ids.authorId,
        title: `${runId} ${suffix}`,
        slug: `${runId}-${suffix}`,
        bodyMd: "Live body.",
        thumbnailUrl: "https://img.example.com/live.jpg",
        categoryId: ids.categoryId,
        status: "published",
        publishAt: new Date(Date.now() - 1000),
      })
      .returning({ id: posts.id, slug: posts.slug });
    return row!;
  }

  it("stages an edit to a published post into the buffer, leaving live and the cache untouched", async () => {
    const post = await seedPublished("stage-basic");
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await updatePost(post.id, {
      title: `${runId} staged title`,
    });
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post.id));
    // Live content is unchanged...
    expect(row!.title).toBe(`${runId} stage-basic`);
    // ...the pending snapshot holds the edit...
    const draftRow = await loadDraftRow(post.id);
    expect(draftRow?.title).toBe(`${runId} staged title`);
    expect(draftRow?.updatedAt).not.toBeNull();
    // ...and staging never revalidates public caches (live is unchanged).
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("merges a second staged edit onto the buffer, seeding tags from live on the first", async () => {
    const post = await seedPublished("stage-merge");
    const [tag] = await testDb
      .insert(tags)
      .values({ slug: `${runId}-sm-tag`, name: `${runId}-sm-tag` })
      .returning({ id: tags.id });
    await testDb.insert(postTags).values({ postId: post.id, tagId: tag!.id });
    authorSession();

    await updatePost(post.id, { title: `${runId} merged one` });
    await updatePost(post.id, { bodyMd: "Staged body two." });

    const draftRow = await loadDraftRow(post.id);
    expect(draftRow?.title).toBe(`${runId} merged one`); // from the first edit
    expect(draftRow?.bodyMd).toBe("Staged body two."); // from the second
    expect(draftRow?.tags).toEqual([`${runId}-sm-tag`]); // seeded from live
  });

  it("refuses to stage an edit that clears a public post's thumbnail", async () => {
    const post = await seedPublished("stage-thumb");
    authorSession();

    const result = await updatePost(post.id, { thumbnailUrl: "" });
    expect(result).toEqual({
      ok: false,
      error: "A published or scheduled post must keep its thumbnail.",
    });
    expect(await loadDraftRow(post.id)).toBeUndefined();
  });

  it("clears the buffer when a staged edit reverts back to the live content", async () => {
    const post = await seedPublished("stage-revert");
    authorSession();

    await updatePost(post.id, { title: `${runId} temp title` });
    expect(await loadDraftRow(post.id)).not.toBeUndefined();

    // Revert the title back to the live value — nothing left to stage.
    const revert = await updatePost(post.id, {
      title: `${runId} stage-revert`,
    });
    expect(revert.ok).toBe(true);
    expect(await loadDraftRow(post.id)).toBeUndefined();
  });

  it("surfaces a slug collision at stage time, not only at publish", async () => {
    const other = await seedPublished("stage-slug-other");
    const post = await seedPublished("stage-slug-mine");
    authorSession();

    const result = await updatePost(post.id, { slug: other.slug });
    expect(result).toEqual({ ok: false, error: "That slug is taken." });
    expect(await loadDraftRow(post.id)).toBeUndefined();
  });

  it("writes edits to a scheduled (future) post live, not into the buffer", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: ids.authorId,
        title: `${runId} sched-future`,
        slug: `${runId}-sched-future`,
        bodyMd: "Body.",
        thumbnailUrl: "https://img.example.com/live.jpg",
        categoryId: ids.categoryId,
        status: "scheduled",
        publishAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      .returning({ id: posts.id });
    authorSession();

    // A scheduled post whose publish_at is still in the future isn't public
    // yet, so its edits write live (nothing would promote a buffer at publish).
    const result = await updatePost(post!.id, {
      title: `${runId} sched-future edited`,
    });
    expect(result.ok).toBe(true);
    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.title).toBe(`${runId} sched-future edited`);
    expect(await loadDraftRow(post!.id)).toBeUndefined();
  });
});

describe("deletePost", () => {
  it("rejects an author but allows an admin, removing the post and its tags", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: ids.authorId,
        title: `${runId} delete target`,
        slug: `${runId}-delete-target`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId: ids.categoryId,
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
