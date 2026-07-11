import { inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { slugifyCore } from "@/lib/shared/slug";

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// same pattern as src/lib/posts/admin.test.ts: one pool/db serves both the
// mocked "@/db" (used by the service under test) and the seeding/cleanup
// code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { createCategoryService, updateCategoryService } =
  await import("./service");
const { listActiveCategories, listAllCategories } = await import("./data");

const { categories } = schema;

const runId = `t-srch1-${crypto.randomUUID().slice(0, 8)}`;
const seededIds: number[] = [];

async function seedCategory(opts: {
  slug: string;
  name: string;
  active?: boolean;
  sortOrder?: number;
}): Promise<number> {
  const [row] = await testDb
    .insert(categories)
    .values(opts)
    .returning({ id: categories.id });
  seededIds.push(row!.id);
  return row!.id;
}

afterAll(async () => {
  await testDb.delete(categories).where(inArray(categories.id, seededIds));
  await testDb.delete(categories).where(like(categories.slug, `${runId}%`));
  await pool.end();
});

describe("createCategoryService", () => {
  it("derives the slug from the name and creates the category", async () => {
    const name = `${runId} NHL`;
    const result = await createCategoryService(name);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    seededIds.push(result.data.id);

    expect(result.data.name).toBe(name);
    expect(result.data.slug).toBe(slugifyCore(name));
    expect(result.data.active).toBe(true);
  });

  it("rejects a duplicate name (slug conflict)", async () => {
    const name = `${runId} Duplicate League`;
    const first = await createCategoryService(name);
    expect(first.ok).toBe(true);
    if (first.ok) seededIds.push(first.data.id);

    const second = await createCategoryService(name);
    expect(second).toEqual({
      ok: false,
      error: "A category with that name already exists.",
    });
  });

  it("rejects a name with no slugifiable characters", async () => {
    const result = await createCategoryService("🔥🔥🔥");
    expect(result).toEqual({
      ok: false,
      error: "Category name must contain letters or numbers.",
    });
  });
});

describe("updateCategoryService", () => {
  it("renames a category without changing its slug", async () => {
    const id = await seedCategory({
      slug: `${runId}-rename`,
      name: `${runId} Before`,
    });

    const result = await updateCategoryService(id, {
      name: `${runId} After`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe(`${runId} After`);
    expect(result.data.slug).toBe(`${runId}-rename`);
  });

  it("deactivating removes a category from listActiveCategories but keeps it in listAllCategories", async () => {
    const id = await seedCategory({
      slug: `${runId}-deactivate`,
      name: `${runId} Deactivate Me`,
    });

    const result = await updateCategoryService(id, { active: false });
    expect(result.ok).toBe(true);

    const active = await listActiveCategories();
    expect(active.some((c) => c.id === id)).toBe(false);

    const all = await listAllCategories();
    expect(all.some((c) => c.id === id)).toBe(true);
  });

  it("sortOrder drives listAllCategories ordering", async () => {
    const higherId = await seedCategory({
      slug: `${runId}-sort-higher`,
      name: `${runId} A Sort`,
      sortOrder: 2,
    });
    const lowerId = await seedCategory({
      slug: `${runId}-sort-lower`,
      name: `${runId} Z Sort`,
      sortOrder: 1,
    });

    const all = await listAllCategories();
    const ids = all.map((c) => c.id);
    expect(ids.indexOf(lowerId)).toBeLessThan(ids.indexOf(higherId));
  });

  it("listActiveCategories orders by sortOrder asc, then name asc as a tiebreak", async () => {
    const higherId = await seedCategory({
      slug: `${runId}-active-sort-higher`,
      name: `${runId} A Active Sort`,
      sortOrder: 2,
    });
    const lowerId = await seedCategory({
      slug: `${runId}-active-sort-lower`,
      name: `${runId} Z Active Sort`,
      sortOrder: 1,
    });
    const tieAId = await seedCategory({
      slug: `${runId}-active-tie-a`,
      name: `${runId} A Tie`,
      sortOrder: 5,
    });
    const tieZId = await seedCategory({
      slug: `${runId}-active-tie-z`,
      name: `${runId} Z Tie`,
      sortOrder: 5,
    });

    const active = await listActiveCategories();
    const ids = active.map((c) => c.id);
    expect(ids.indexOf(lowerId)).toBeLessThan(ids.indexOf(higherId));
    expect(ids.indexOf(tieAId)).toBeLessThan(ids.indexOf(tieZId));
  });

  it("rejects an empty patch", async () => {
    const id = await seedCategory({
      slug: `${runId}-empty-patch`,
      name: `${runId} Empty Patch`,
    });

    const result = await updateCategoryService(id, {});
    expect(result).toEqual({ ok: false, error: "No changes to save." });
  });

  it("returns an error for an unknown id", async () => {
    const result = await updateCategoryService(-1, { name: "Nope" });
    expect(result).toEqual({ ok: false, error: "Category not found." });
  });
});
