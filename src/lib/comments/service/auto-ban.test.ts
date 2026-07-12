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

// env.ts parses process.env at import time (not populated under an isolated
// vitest run) — pin a small threshold/window so fixtures stay small, same
// reasoning as create.test.ts's rate-limit env mock.
vi.mock("@/lib/shared/env", () => ({
  env: {
    COMMENT_AUTOBAN_REJECTED_THRESHOLD: 3,
    COMMENT_AUTOBAN_WINDOW_DAYS: 7,
  },
}));

// setUserBannedService delegates to the REAL implementation by default below
// (beforeEach) — most of this matrix exercises real bannedAt writes against
// seeded reader-role rows, which never touch the last-active-admin invariant
// (setUserBannedService's removesActiveAdmin check is a no-op for a
// non-admin target). The mock is overridden for exactly the
// last-active-admin case: that invariant reads EVERY admin row in the whole
// table (src/lib/users/data.ts withLockedUserMutation), which this suite
// doesn't own and can't make deterministic here without mutating rows it
// didn't seed (e.g. a real account used for manual testing on this same
// local Postgres instance) — the invariant itself is already exhaustively
// unit-tested (src/lib/users/admin.test.ts's wouldOrphanAdmins) and its
// action-level wiring (src/actions/users.test.ts) deliberately keeps >=2
// admins in play for the same reason. Overriding here proves auto-ban's OWN
// handling of a refusal (swallow, no throw), not the invariant itself.
const setUserBannedServiceMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/users/service", () => ({
  setUserBannedService: setUserBannedServiceMock,
}));

const { maybeAutoBanForRejectedComment } = await import("./auto-ban");
const { setUserBannedService: realSetUserBannedService } =
  await vi.importActual<typeof import("@/lib/users/service")>(
    "@/lib/users/service",
  );

const { categories, comments, posts, user } = schema;

const SEED_PREFIX = "t-cmt-autoban-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const authorId = `user-${runId}-author`;
const bannedAuthorId = `user-${runId}-banned`;
const adminAuthorId = `user-${runId}-admin`;
const ALL_USER_IDS = [authorId, bannedAuthorId, adminAuthorId];

const PRE_BANNED_AT = new Date("2026-01-01T00:00:00Z");

let categoryId: number;
let postId: string;

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
      id: bannedAuthorId,
      name: `Banned Author ${runId}`,
      email: `banned-${runId}@example.com`,
      role: "reader",
      bannedAt: PRE_BANNED_AT,
    },
    {
      id: adminAuthorId,
      name: `Admin Author ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;

  const [post] = await testDb
    .insert(posts)
    .values({
      authorId,
      title: `Post ${runId}`,
      slug: `${runId}-post`,
      bodyMd: "Body.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      categoryId,
      status: "published",
      publishAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: posts.id });
  postId = post!.id;
});

afterAll(async () => {
  await testDb.delete(comments).where(eq(comments.postId, postId));
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, ALL_USER_IDS));
  await pool.end();
});

beforeEach(async () => {
  setUserBannedServiceMock.mockImplementation(realSetUserBannedService);
  await testDb.delete(comments).where(eq(comments.postId, postId));
  await testDb
    .update(user)
    .set({ bannedAt: null })
    .where(inArray(user.id, [authorId, adminAuthorId]));
});

async function bannedAtOf(id: string): Promise<Date | null> {
  const [row] = await testDb
    .select({ bannedAt: user.bannedAt })
    .from(user)
    .where(eq(user.id, id));
  return row!.bannedAt;
}

async function seedComment(overrides: {
  authorId: string;
  status: "visible" | "held" | "rejected" | "deleted";
  createdAt?: Date;
  editedAt?: Date | null;
}): Promise<string> {
  const values: typeof comments.$inferInsert = {
    postId,
    authorId: overrides.authorId,
    parentId: null,
    body: "x",
    status: overrides.status,
  };
  if (overrides.createdAt !== undefined) values.createdAt = overrides.createdAt;
  if (overrides.editedAt !== undefined) values.editedAt = overrides.editedAt;

  const [row] = await testDb
    .insert(comments)
    .values(values)
    .returning({ id: comments.id });
  return row!.id;
}

async function seedRejected(
  authorIdForRow: string,
  count: number,
  opts: { createdAt?: Date; editedAt?: Date | null } = {},
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedComment({
      authorId: authorIdForRow,
      status: "rejected",
      ...opts,
    });
  }
}

describe("maybeAutoBanForRejectedComment", () => {
  const now = new Date();

  it("bans the author when the rejected count reaches exactly the threshold", async () => {
    await seedRejected(authorId, 3);

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).not.toBeNull();
  });

  it("does not ban below the threshold", async () => {
    await seedRejected(authorId, 2);

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).toBeNull();
  });

  it("does not count held/visible/deleted rows toward the threshold", async () => {
    await seedComment({ authorId, status: "held" });
    await seedComment({ authorId, status: "visible" });
    await seedComment({ authorId, status: "deleted" });

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).toBeNull();
  });

  it("does not count rejected rows outside the window (created_at AND edited_at both stale)", async () => {
    const staleCreated = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const staleEdited = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);
    await seedRejected(authorId, 3, {
      createdAt: staleCreated,
      editedAt: staleEdited,
    });

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).toBeNull();
  });

  it("counts an old comment demoted to rejected by a fresh edit (stale created_at, fresh edited_at)", async () => {
    const staleCreated = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    await seedRejected(authorId, 3, { createdAt: staleCreated, editedAt: now });

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).not.toBeNull();
  });

  it("drops below the threshold (and skips the ban) once an admin restore flips one row back to visible", async () => {
    const ids = await Promise.all(
      Array.from({ length: 3 }, () =>
        seedComment({ authorId, status: "rejected" }),
      ),
    );
    await testDb
      .update(comments)
      .set({ status: "visible" })
      .where(eq(comments.id, ids[0]!));

    await maybeAutoBanForRejectedComment(authorId, now);

    expect(await bannedAtOf(authorId)).toBeNull();
  });

  it("is a no-op (no error, stays banned) when the author is already banned", async () => {
    await seedRejected(bannedAuthorId, 3);

    await expect(
      maybeAutoBanForRejectedComment(bannedAuthorId, now),
    ).resolves.toBeUndefined();

    expect(await bannedAtOf(bannedAuthorId)).toEqual(PRE_BANNED_AT);
  });

  it("swallows a last-active-admin refusal without banning or throwing", async () => {
    setUserBannedServiceMock.mockResolvedValueOnce({
      ok: false,
      error: "You can't ban the last admin.",
    });
    await seedRejected(adminAuthorId, 3);

    await expect(
      maybeAutoBanForRejectedComment(adminAuthorId, now),
    ).resolves.toBeUndefined();

    expect(setUserBannedServiceMock).toHaveBeenCalledWith(adminAuthorId, true);
    expect(await bannedAtOf(adminAuthorId)).toBeNull();
  });
});
