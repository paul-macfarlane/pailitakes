import { eq, like } from "drizzle-orm";
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

// Same DB-backed harness as the other lib tests (vi.hoisted pool + mocked
// "@/db"); the functions run their real queries against it.
const { pool, testDb } = await vi.hoisted(async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
});

vi.mock("@/db", () => ({ db: testDb }));

const { getCrossedSlugs, advanceRevalidationMarker, normalizePostStatuses } =
  await import("./revalidation");

const { categories, posts, revalidationState, user } = schema;

const runId = `t-adm9-${crypto.randomUUID().slice(0, 8)}`;
const authorId = `user-${runId}`;
let categoryId: number;

const BASE = new Date("2026-06-01T00:00:00Z");
const IN_WINDOW = new Date("2026-06-01T00:02:00Z");
const NOW = new Date("2026-06-01T00:05:00Z");
const BEFORE_WINDOW = new Date("2026-05-01T00:00:00Z");

async function seedPost(opts: {
  suffix: string;
  status: "draft" | "scheduled" | "published" | "archived";
  publishAt?: Date | null;
  archiveAt?: Date | null;
}) {
  const [row] = await testDb
    .insert(posts)
    .values({
      authorId,
      title: `${runId} ${opts.suffix}`,
      slug: `${runId}-${opts.suffix}`,
      bodyMd: "b",
      thumbnailUrl: "https://img.example.com/t.jpg",
      categoryId,
      status: opts.status,
      publishAt: opts.publishAt ?? null,
      archiveAt: opts.archiveAt ?? null,
    })
    .returning({ id: posts.id, slug: posts.slug });
  return row!;
}

// revalidation_state is a global singleton; set a known last-run before each
// case (this is the only test file that touches it).
async function setLastRun(at: Date | null) {
  await testDb.delete(revalidationState);
  if (at) {
    await testDb.insert(revalidationState).values({ id: true, lastRunAt: at });
  }
}

beforeAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(user).where(eq(user.id, authorId));

  await testDb.insert(user).values({
    id: authorId,
    name: `Cron Author ${runId}`,
    email: `${runId}@example.com`,
    role: "author",
  });
  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Cat ${runId}` })
    .returning({ id: categories.id });
  categoryId = category!.id;
});

beforeEach(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
});

afterAll(async () => {
  await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
  await testDb.delete(revalidationState);
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, authorId));
  await pool.end();
});

describe("getCrossedSlugs", () => {
  it("returns a scheduled post whose publish_at crossed the window", async () => {
    await setLastRun(BASE);
    const post = await seedPost({
      suffix: "pub-cross",
      status: "scheduled",
      publishAt: IN_WINDOW,
    });
    expect(await getCrossedSlugs(NOW)).toContain(post.slug);
  });

  it("returns a published post whose archive_at crossed the window", async () => {
    await setLastRun(BASE);
    const post = await seedPost({
      suffix: "arch-cross",
      status: "published",
      publishAt: BEFORE_WINDOW,
      archiveAt: IN_WINDOW,
    });
    expect(await getCrossedSlugs(NOW)).toContain(post.slug);
  });

  it("excludes a draft whose publish_at crossed (status filter)", async () => {
    await setLastRun(BASE);
    const post = await seedPost({
      suffix: "draft-cross",
      status: "draft",
      publishAt: IN_WINDOW,
    });
    expect(await getCrossedSlugs(NOW)).not.toContain(post.slug);
  });

  it("excludes an archived post whose archive_at crossed (status filter)", async () => {
    await setLastRun(BASE);
    const post = await seedPost({
      suffix: "archived-cross",
      status: "archived",
      publishAt: BEFORE_WINDOW,
      archiveAt: IN_WINDOW,
    });
    expect(await getCrossedSlugs(NOW)).not.toContain(post.slug);
  });

  it("excludes a crossing that happened before the window", async () => {
    await setLastRun(BASE);
    const post = await seedPost({
      suffix: "old-cross",
      status: "scheduled",
      publishAt: BEFORE_WINDOW, // <= lastRun
    });
    expect(await getCrossedSlugs(NOW)).not.toContain(post.slug);
  });

  it("returns [] when the marker is at/after now, or absent", async () => {
    await seedPost({
      suffix: "empty-window",
      status: "scheduled",
      publishAt: IN_WINDOW,
    });
    await setLastRun(NOW);
    expect(await getCrossedSlugs(NOW)).toEqual([]);
    await setLastRun(null);
    expect(await getCrossedSlugs(NOW)).toEqual([]);
  });

  it("is READ-ONLY — the caller must advance the marker separately (at-least-once)", async () => {
    await setLastRun(BASE);
    await seedPost({
      suffix: "readonly",
      status: "scheduled",
      publishAt: IN_WINDOW,
    });
    expect((await getCrossedSlugs(NOW)).length).toBeGreaterThan(0);
    // A crash before advancing would reprocess: the second read still sees it.
    expect((await getCrossedSlugs(NOW)).length).toBeGreaterThan(0);
  });
});

describe("advanceRevalidationMarker", () => {
  it("moves the marker to now, closing the window", async () => {
    await setLastRun(BASE);
    await seedPost({
      suffix: "advance",
      status: "scheduled",
      publishAt: IN_WINDOW,
    });
    expect((await getCrossedSlugs(NOW)).length).toBeGreaterThan(0);

    await advanceRevalidationMarker(NOW);
    expect(await getCrossedSlugs(NOW)).toEqual([]);

    const [state] = await testDb
      .select({ lastRunAt: revalidationState.lastRunAt })
      .from(revalidationState);
    expect(state!.lastRunAt.getTime()).toBe(NOW.getTime());
  });

  it("is monotonic — an earlier now never moves the marker backward", async () => {
    const later = new Date("2026-06-01T00:10:00Z");
    await setLastRun(later);

    await advanceRevalidationMarker(NOW); // NOW (00:05) < later (00:10)

    const [state] = await testDb
      .select({ lastRunAt: revalidationState.lastRunAt })
      .from(revalidationState);
    expect(state!.lastRunAt.getTime()).toBe(later.getTime());
  });

  it("inserts the row when absent", async () => {
    await setLastRun(null);
    await advanceRevalidationMarker(NOW);
    const rows = await testDb
      .select({ lastRunAt: revalidationState.lastRunAt })
      .from(revalidationState);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastRunAt.getTime()).toBe(NOW.getTime());
  });
});

describe("normalizePostStatuses", () => {
  async function statusOf(id: string) {
    const [row] = await testDb
      .select({ status: posts.status, draft: posts.draft })
      .from(posts)
      .where(eq(posts.id, id));
    return row!;
  }

  it("flips a scheduled post to published once its publish_at has passed, and counts it", async () => {
    const post = await seedPost({
      suffix: "norm-pub",
      status: "scheduled",
      publishAt: BEFORE_WINDOW,
    });
    const count = await normalizePostStatuses(NOW);
    expect(count).toBeGreaterThanOrEqual(1);
    expect((await statusOf(post.id)).status).toBe("published");
  });

  it("leaves a scheduled post whose publish_at is still in the future", async () => {
    const future = new Date("2026-07-01T00:00:00Z");
    const post = await seedPost({
      suffix: "norm-future",
      status: "scheduled",
      publishAt: future,
    });
    await normalizePostStatuses(NOW);
    expect((await statusOf(post.id)).status).toBe("scheduled");
  });

  it("archives a published post past its archive_at and clears any staged draft", async () => {
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId,
        title: `${runId} norm-arch`,
        slug: `${runId}-norm-arch`,
        bodyMd: "b",
        thumbnailUrl: "https://img.example.com/t.jpg",
        categoryId,
        status: "published",
        publishAt: BEFORE_WINDOW,
        archiveAt: IN_WINDOW,
        draft: {
          title: `${runId} staged`,
          slug: `${runId}-norm-arch`,
          bodyMd: "staged",
          categoryId,
          thumbnailUrl: "https://img.example.com/t.jpg",
          bannerUrl: null,
          videoUrl: null,
          tags: [],
        },
      })
      .returning({ id: posts.id });

    await normalizePostStatuses(NOW);
    const after = await statusOf(post!.id);
    expect(after.status).toBe("archived");
    // A pending snapshot must not be stranded on a now-hidden post (ADR-0011).
    expect(after.draft).toBeNull();
  });

  it("is idempotent — a second run leaves already-normalized rows unchanged", async () => {
    const post = await seedPost({
      suffix: "norm-idem",
      status: "scheduled",
      publishAt: BEFORE_WINDOW,
    });
    await normalizePostStatuses(NOW);
    // A second run leaves this already-normalized row unchanged (asserting on
    // the row, not a global count, since the sweep is DB-wide).
    await normalizePostStatuses(NOW);
    expect((await statusOf(post.id)).status).toBe("published");
  });
});
