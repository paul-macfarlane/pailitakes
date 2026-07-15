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

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// one pool/db serves both the mocked "@/db" and the seeding/cleanup code
// here (same pattern as src/lib/comments/data.test.ts).
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// withLockedUserMutation's activeAdminIds is a site-wide scan of EVERY admin
// row in the table (src/lib/users/data.ts) — on a shared local Postgres that
// also holds a real account used for manual testing (and rows from other
// test files running concurrently), asserting the true "last active admin"
// branch can't be made deterministic against the real count. Same reasoning
// and technique as src/lib/comments/service/auto-ban.test.ts and
// moderation-log.test.ts: keep everything else (the row lock, the target
// read, the transaction anonymizeCommentsForUser writes through) real via
// importActual, and override just the activeAdminIds array the callback
// sees, per test. The invariant itself (wouldOrphanAdmins) is already
// exhaustively unit-tested in src/lib/users/admin.test.ts — this override
// only proves prepareAccountDeletion's OWN wiring of that invariant.
const activeAdminIdsOverride = vi.hoisted(() => ({
  current: null as string[] | null,
}));
vi.mock("@/lib/users/data", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/users/data")>(
      "@/lib/users/data",
    );
  const withLockedUserMutation: typeof actual.withLockedUserMutation = (
    userId,
    fn,
  ) =>
    actual.withLockedUserMutation(userId, (tx, activeAdminIds, target) =>
      fn(tx, activeAdminIdsOverride.current ?? activeAdminIds, target),
    );
  return { ...actual, withLockedUserMutation };
});

const {
  ACCOUNT_HAS_POSTS_ERROR,
  ACCOUNT_LAST_ADMIN_ERROR,
  TRANSFER_SAME_USER_ERROR,
  TRANSFER_TARGET_INVALID_ERROR,
  prepareAccountDeletion,
  transferUserPostsService,
} = await import("./service");
const { revalidateTag } = await import("next/cache");
const { loadCommentRowsForPost } = await import("@/lib/comments/data");
const { buildCommentTree } = await import("@/lib/comments/tree");

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-acct1-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const deletingId = `user-${runId}-deleting`;
const otherId = `user-${runId}-other`;
const postAuthorId = `user-${runId}-postauthor`;
const authoredPostsId = `user-${runId}-hasposts`;
const soleAdminId = `user-${runId}-soleadmin`;
const peerAdminId = `user-${runId}-peeradmin`;
const bannedReaderId = `user-${runId}-banned`;
const transferSourceId = `user-${runId}-transfersource`;
const transferAdminTargetId = `user-${runId}-transfertarget`;
const missingUserId = `user-${runId}-missing`;
const ALL_USER_IDS = [
  deletingId,
  otherId,
  postAuthorId,
  authoredPostsId,
  soleAdminId,
  peerAdminId,
  bannedReaderId,
  transferSourceId,
  transferAdminTargetId,
];

let categoryId: number;
let hostPostId: string;

// findNode: buildCommentTree output is a nested tree, not a flat list — the
// anonymized-parent-with-visible-child assertion needs to walk it.
function findNode(
  nodes: ReturnType<typeof buildCommentTree>,
  id: string,
): ReturnType<typeof buildCommentTree>[number] | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

async function commentRow(id: string) {
  const [row] = await testDb.select().from(comments).where(eq(comments.id, id));
  return row!;
}

beforeAll(async () => {
  await sweepStalePostFixtures(testDb, { seedPrefix: SEED_PREFIX });
  await testDb.delete(user).where(inArray(user.id, ALL_USER_IDS));

  await testDb.insert(user).values([
    {
      id: deletingId,
      name: "Deleting",
      email: `d-${runId}@e.com`,
      role: "reader",
    },
    { id: otherId, name: "Other", email: `o-${runId}@e.com`, role: "reader" },
    {
      id: postAuthorId,
      name: "Post Author",
      email: `pa-${runId}@e.com`,
      role: "author",
    },
    {
      id: authoredPostsId,
      name: "Has Posts",
      email: `hp-${runId}@e.com`,
      role: "author",
    },
    {
      id: soleAdminId,
      name: "Sole Admin",
      email: `sa-${runId}@e.com`,
      role: "admin",
    },
    {
      id: peerAdminId,
      name: "Peer Admin",
      email: `pe-${runId}@e.com`,
      role: "admin",
    },
    {
      id: bannedReaderId,
      name: "Banned Reader",
      email: `br-${runId}@e.com`,
      role: "reader",
      bannedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: transferSourceId,
      name: "Transfer Source",
      email: `ts-${runId}@e.com`,
      role: "author",
    },
    {
      id: transferAdminTargetId,
      name: "Transfer Target",
      email: `tt-${runId}@e.com`,
      role: "admin",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;
});

afterAll(async () => {
  if (hostPostId) {
    await testDb.delete(comments).where(eq(comments.postId, hostPostId));
  }
  await testDb.delete(posts).where(eq(posts.categoryId, categoryId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, ALL_USER_IDS));
  await pool.end();
});

beforeEach(() => {
  activeAdminIdsOverride.current = null;
});

describe("prepareAccountDeletion", () => {
  it("purges a never-public, comment-free draft and allows the delete", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: authoredPostsId,
        title: `${runId} draft-only`,
        slug: `${runId}-draft-only`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId,
        // Default status (draft), no publishAt — never public, no comments.
      })
      .returning({ id: posts.id });

    expect(await prepareAccountDeletion(authoredPostsId)).toEqual({ ok: true });

    const [row] = await testDb
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row).toBeUndefined();
  });

  it("refuses when the user has a published post", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: authoredPostsId,
        title: `${runId} published`,
        slug: `${runId}-published`,
        bodyMd: "Body.",
        thumbnailUrl: "https://example.com/thumb.jpg",
        categoryId,
        status: "published",
        publishAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning({ id: posts.id });

    expect(await prepareAccountDeletion(authoredPostsId)).toEqual({
      ok: false,
      error: ACCOUNT_HAS_POSTS_ERROR,
    });

    await testDb.delete(posts).where(eq(posts.id, post!.id));
  });

  it("refuses when a never-public draft has a comment", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: authoredPostsId,
        title: `${runId} draft-commented`,
        slug: `${runId}-draft-commented`,
        bodyMd: "Body.",
        thumbnailUrl: "",
        categoryId,
        // Default status (draft), no publishAt — never public, but a real
        // comment thread blocks the purge (noCommentsGuard, posts/data.ts).
      })
      .returning({ id: posts.id });

    const [comment] = await testDb
      .insert(comments)
      .values({
        postId: post!.id,
        authorId: otherId,
        parentId: null,
        body: "A stray comment on a reverted-to-draft post.",
        status: "visible",
        modVerdict: {
          verdict: "allow",
          reason: "fine",
          model: "m",
          latencyMs: 1,
        },
      })
      .returning({ id: comments.id });

    expect(await prepareAccountDeletion(authoredPostsId)).toEqual({
      ok: false,
      error: ACCOUNT_HAS_POSTS_ERROR,
    });

    await testDb.delete(comments).where(eq(comments.id, comment!.id));
    await testDb.delete(posts).where(eq(posts.id, post!.id));
  });

  it("refuses when the user is the last active admin", async () => {
    activeAdminIdsOverride.current = [soleAdminId];

    expect(await prepareAccountDeletion(soleAdminId)).toEqual({
      ok: false,
      error: ACCOUNT_LAST_ADMIN_ERROR,
    });
  });

  it("allows an admin to delete when another active admin exists", async () => {
    activeAdminIdsOverride.current = [peerAdminId, soleAdminId];

    expect(await prepareAccountDeletion(peerAdminId)).toEqual({ ok: true });
  });

  it("allows a banned reader to delete their own account", async () => {
    expect(await prepareAccountDeletion(bannedReaderId)).toEqual({
      ok: true,
    });
  });
});

describe("prepareAccountDeletion — comment anonymization", () => {
  let postId: string;
  let visibleId: string;
  let heldId: string;
  let rejectedParentId: string;
  let childByOtherId: string;
  let otherOwnCommentId: string;

  beforeAll(async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: postAuthorId,
        title: `${runId} host`,
        slug: `${runId}-host`,
        bodyMd: "Body.",
        thumbnailUrl: "https://example.com/thumb.jpg",
        categoryId,
        status: "published",
        publishAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning({ id: posts.id });
    postId = post!.id;
    hostPostId = postId;

    const [visible] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: deletingId,
        parentId: null,
        body: "Visible top-level.",
        status: "visible",
        modVerdict: {
          verdict: "allow",
          reason: "fine",
          model: "m",
          latencyMs: 1,
        },
      })
      .returning({ id: comments.id });
    visibleId = visible!.id;

    const [held] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: deletingId,
        parentId: null,
        body: "Held top-level.",
        status: "held",
        modVerdict: { error: "timeout", model: "m", latencyMs: 1 },
      })
      .returning({ id: comments.id });
    heldId = held!.id;

    const [rejectedParent] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: deletingId,
        parentId: null,
        body: "Rejected top-level, has a reply from someone else.",
        status: "rejected",
        modVerdict: {
          verdict: "flag",
          reason: "spam",
          model: "m",
          latencyMs: 1,
        },
      })
      .returning({ id: comments.id });
    rejectedParentId = rejectedParent!.id;

    const [childByOther] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: otherId,
        parentId: rejectedParentId,
        body: "A reply from another user.",
        status: "visible",
        modVerdict: {
          verdict: "allow",
          reason: "fine",
          model: "m",
          latencyMs: 1,
        },
      })
      .returning({ id: comments.id });
    childByOtherId = childByOther!.id;

    const [otherOwn] = await testDb
      .insert(comments)
      .values({
        postId,
        authorId: otherId,
        parentId: null,
        body: "Another user's own untouched comment.",
        status: "visible",
        modVerdict: {
          verdict: "allow",
          reason: "fine",
          model: "m",
          latencyMs: 1,
        },
      })
      .returning({ id: comments.id });
    otherOwnCommentId = otherOwn!.id;
  });

  it("anonymizes every one of the deleting user's comments regardless of status, and leaves another user's comments untouched", async () => {
    expect(await prepareAccountDeletion(deletingId)).toEqual({ ok: true });

    for (const id of [visibleId, heldId, rejectedParentId]) {
      expect(await commentRow(id)).toMatchObject({
        authorId: null,
        status: "deleted",
        body: "",
        modVerdict: null,
      });
    }

    expect(await commentRow(childByOtherId)).toMatchObject({
      authorId: otherId,
      status: "visible",
      body: "A reply from another user.",
    });
    expect(await commentRow(otherOwnCommentId)).toMatchObject({
      authorId: otherId,
      status: "visible",
      body: "Another user's own untouched comment.",
    });
  });

  it("keeps anonymized rows loadable (and a visible child of an anonymized parent attached) after the user row itself is gone", async () => {
    // Mirrors the real flow: beforeDelete anonymizes first (previous test),
    // then better-auth's internalAdapter.deleteUser removes the row. The FK
    // stays RESTRICT, so this only succeeds because every comment is already
    // anonymized (author_id NULL) — proving the invariant this whole feature
    // depends on.
    await testDb.delete(user).where(eq(user.id, deletingId));

    const rows = await loadCommentRowsForPost(postId, null);
    const rejectedParentRow = rows.find((r) => r.id === rejectedParentId);
    expect(rejectedParentRow).toMatchObject({
      authorId: null,
      status: "deleted",
    });

    const tree = buildCommentTree(rows);

    // The anonymized visible/held top-levels have no children -> pruned.
    expect(findNode(tree, visibleId)).toBeUndefined();
    expect(findNode(tree, heldId)).toBeUndefined();

    // The anonymized rejected parent has a visible child -> kept as a
    // redacted placeholder, same rule as any other non-visible node (D5).
    const placeholder = findNode(tree, rejectedParentId);
    expect(placeholder).toMatchObject({
      status: "deleted",
      body: "",
      author: null,
    });
    expect(placeholder!.children.map((c) => c.id)).toEqual([childByOtherId]);

    const child = findNode(tree, childByOtherId);
    expect(child).toMatchObject({
      status: "visible",
      body: "A reply from another user.",
      author: { id: otherId },
    });

    // Another user's untouched comment is unaffected by the whole flow.
    const otherOwn = findNode(tree, otherOwnCommentId);
    expect(otherOwn).toMatchObject({
      status: "visible",
      body: "Another user's own untouched comment.",
    });
  });
});

describe("transferUserPostsService", () => {
  beforeEach(() => {
    vi.mocked(revalidateTag).mockClear();
  });

  it("moves every post from one user to another and returns the count", async () => {
    const inserted = await testDb
      .insert(posts)
      .values([
        {
          authorId: transferSourceId,
          title: `${runId} transfer-a`,
          slug: `${runId}-transfer-a`,
          bodyMd: "Body.",
          thumbnailUrl: "",
          categoryId,
        },
        {
          authorId: transferSourceId,
          title: `${runId} transfer-b`,
          slug: `${runId}-transfer-b`,
          bodyMd: "Body.",
          thumbnailUrl: "",
          categoryId,
        },
      ])
      .returning({ id: posts.id, slug: posts.slug });

    expect(
      await transferUserPostsService(transferSourceId, transferAdminTargetId),
    ).toEqual({ ok: true, data: { transferred: 2 } });

    const rows = await testDb
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(
        inArray(
          posts.id,
          inserted.map((p) => p.id),
        ),
      );
    expect(rows).toEqual([
      { authorId: transferAdminTargetId },
      { authorId: transferAdminTargetId },
    ]);

    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
    for (const { slug } of inserted) {
      expect(revalidateTag).toHaveBeenCalledWith(
        `post:${slug}`,
        expect.anything(),
      );
    }

    await testDb.delete(posts).where(
      inArray(
        posts.id,
        inserted.map((p) => p.id),
      ),
    );
  });

  it("refuses transferring a user's posts to themselves", async () => {
    expect(
      await transferUserPostsService(transferSourceId, transferSourceId),
    ).toEqual({ ok: false, error: TRANSFER_SAME_USER_ERROR });
  });

  it("refuses a banned target", async () => {
    expect(
      await transferUserPostsService(transferSourceId, bannedReaderId),
    ).toEqual({ ok: false, error: TRANSFER_TARGET_INVALID_ERROR });
  });

  it("refuses a target without AccessAdmin (reader)", async () => {
    expect(await transferUserPostsService(transferSourceId, otherId)).toEqual({
      ok: false,
      error: TRANSFER_TARGET_INVALID_ERROR,
    });
  });

  it("refuses a missing target", async () => {
    expect(
      await transferUserPostsService(transferSourceId, missingUserId),
    ).toEqual({ ok: false, error: TRANSFER_TARGET_INVALID_ERROR });
  });
});
