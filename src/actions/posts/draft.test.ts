import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
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

const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
  requireStaff: async () => {
    throw new Error("requireStaff is unmocked — actions must use getSession");
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// updatePost is imported only to ARRANGE staged changes on a published post
// — the action under test in this file is publishPostChanges/
// discardPostChanges. See crud.test.ts for updatePost's own staging
// behavior and lifecycle.test.ts for the pending-changes lifecycle guard.
const { updatePost } = await import("./crud");
const { publishPostChanges, discardPostChanges } = await import("./draft");
const { revalidateTag } = await import("next/cache");

const { posts, tags } = schema;
const loadDraftRow = draftRowLoader(testDb);

const SEED_PREFIX = "t-adm3b-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

let ids: StaffFixtureIds;

function authorSession() {
  sessionMock.current = sessionUser(ids.authorId, "author");
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

// Promoting/discarding a public post's staged edits (its post_drafts row,
// ADR-0011).
// See crud.test.ts for updatePost's own staging behavior (writing into the
// buffer) and lifecycle.test.ts for the pending-changes lifecycle guard.
describe("publishPostChanges / discardPostChanges (ADR-0011)", () => {
  it("publishPostChanges promotes the buffer to live, clears it, and revalidates", async () => {
    const post = await seedPublished("promote");
    authorSession();
    await updatePost(post.id, {
      title: `${runId} promoted title`,
      bodyMd: "Promoted body.",
    });
    vi.mocked(revalidateTag).mockClear();

    const result = await publishPostChanges(post.id);
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.title).toBe(`${runId} promoted title`);
    expect(row!.bodyMd).toBe("Promoted body.");
    expect(await loadDraftRow(post.id)).toBeUndefined();
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${post.slug}`,
      expect.anything(),
    );
  });

  it("publishPostChanges is a no-op success when nothing is staged", async () => {
    const post = await seedPublished("promote-noop");
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await publishPostChanges(post.id);
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, slug: post.slug },
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("publishPostChanges revalidates both slugs when the staged slug differs", async () => {
    const post = await seedPublished("promote-slug");
    authorSession();
    const newSlug = `${runId}-promote-slug-renamed`;
    await updatePost(post.id, { slug: newSlug });
    vi.mocked(revalidateTag).mockClear();

    const result = await publishPostChanges(post.id);
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

  it("discardPostChanges clears the buffer without revalidating or changing live", async () => {
    const post = await seedPublished("discard");
    authorSession();
    await updatePost(post.id, { title: `${runId} discarded title` });
    vi.mocked(revalidateTag).mockClear();

    const result = await discardPostChanges(post.id);
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.title).toBe(`${runId} discard`); // live unchanged
    expect(await loadDraftRow(post.id)).toBeUndefined();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects publish/discard from a non-owner author", async () => {
    const post = await seedPublished("promote-owner");
    authorSession();
    await updatePost(post.id, { title: `${runId} owned stage` });

    // A non-owner AUTHOR passes the staff gate, fails ownership.
    sessionMock.current = sessionUser(ids.readerId, "author");
    expect(await publishPostChanges(post.id)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(await discardPostChanges(post.id)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    // The buffer survived the rejected calls.
    const draftRow = await loadDraftRow(post.id);
    expect(draftRow?.title).toBe(`${runId} owned stage`);
  });
});
