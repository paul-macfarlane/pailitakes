// Shared fixtures/setup for DB-backed and session-mocked Vitest suites
// (actions + src/lib/posts/*). Deliberately NOT *.test.ts so Vitest never
// collects it as a spec, and nothing outside tests imports it.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, like, lt, notExists, sql } from "drizzle-orm";

import * as schema from "@/db/schema";

export type TestDb = NodePgDatabase<typeof schema>;

// vi.hoisted-friendly factory: each test file still does
// `const { pool, testDb } = await vi.hoisted(() => createTestDb());` itself
// (vi.mock factories are hoisted above regular imports/consts in THAT file,
// so the call site — not this helper — must live inside vi.hoisted). This
// just dedupes the pool/drizzle wiring that used to be copy-pasted per file.
export async function createTestDb(): Promise<{
  pool: import("pg").Pool;
  testDb: TestDb;
}> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
}

// Hygiene sweep of leftovers from runs that died before their afterAll ran.
// Age-gated (and, for tags/categories, reference-gated — neither table has a
// createdAt column) so a concurrent run's fresh rows are never touched.
// Assertions never depend on this sweep running — isolation comes from each
// run's unique runId — so it's arrange-only, same as before extraction.
export async function sweepStalePostFixtures(
  testDb: TestDb,
  opts: { seedPrefix: string; tagSlugPattern?: string },
): Promise<void> {
  const { posts, tags, categories, user, postTags } = schema;
  const tagSlugPattern = opts.tagSlugPattern ?? `${opts.seedPrefix}%`;
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000);

  await testDb
    .delete(posts)
    .where(
      and(
        like(posts.slug, `${opts.seedPrefix}%`),
        lt(posts.createdAt, staleBefore),
      ),
    );
  await testDb.delete(tags).where(
    and(
      like(tags.slug, tagSlugPattern),
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
      like(categories.slug, `cat-${opts.seedPrefix}%`),
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
        like(user.id, `user-${opts.seedPrefix}%`),
        lt(user.createdAt, staleBefore),
      ),
    );
}

export interface StaffFixtureIds {
  authorId: string;
  adminId: string;
  readerId: string;
  categoryId: number;
}

// Seeds the author/admin/reader trio + one category that the posts-action
// test files (crud/draft/lifecycle) each need under their own runId. Callers
// that don't exercise a particular role (e.g. draft.test.ts never asserts
// against adminId) simply don't destructure that field — the row still
// exists for referential/authz-scoping realism and is cleaned up by
// clearStaffFixtures.
export async function seedStaffFixtures(
  testDb: TestDb,
  runId: string,
): Promise<StaffFixtureIds> {
  const { categories, user } = schema;
  const authorId = `user-${runId}-author`;
  const adminId = `user-${runId}-admin`;
  const readerId = `user-${runId}-reader`;

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

  return { authorId, adminId, readerId, categoryId: category!.id };
}

// Mirror of seedStaffFixtures for afterAll — deletes exactly what it created.
export async function clearStaffFixtures(
  testDb: TestDb,
  ids: StaffFixtureIds,
): Promise<void> {
  const { categories, user } = schema;
  await testDb
    .delete(user)
    .where(inArray(user.id, [ids.authorId, ids.adminId, ids.readerId]));
  await testDb.delete(categories).where(eq(categories.id, ids.categoryId));
}

export type SessionRole = "reader" | "author" | "admin";

// Builds the `{ user }` shape the mocked "@/lib/auth/session" getSession()
// returns. Test files still declare their own `vi.hoisted` sessionMock
// object and `vi.mock("@/lib/auth/session", ...)` call (mock factories must
// be hoisted within the file that registers them) — this just dedupes the
// repeated session-value literal.
export function sessionUser(
  id: string,
  role: SessionRole,
  bannedAt: Date | null = null,
) {
  return { user: { id, role, bannedAt } };
}

// The staged-draft buffer lives in its own 1:1 table (ADR-0012). Shared
// loader for the "draft storage internals" assertions in crud.test.ts and
// draft.test.ts (undefined means no pending changes).
export function draftRowLoader(testDb: TestDb) {
  const { postDrafts } = schema;
  return async function loadDraftRow(postId: string) {
    const [row] = await testDb
      .select()
      .from(postDrafts)
      .where(eq(postDrafts.postId, postId));
    return row;
  };
}
