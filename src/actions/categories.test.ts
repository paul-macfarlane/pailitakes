import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sessionSetters, sessionUser } from "@/test/helpers";

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
    throw new Error("requireStaff is unmocked");
  },
  requireAdmin: async () => {
    throw new Error("requireAdmin is unmocked");
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { createCategory, updateCategory } = await import("./categories");

const { categories } = schema;

const runId = `t-srch1act-${crypto.randomUUID().slice(0, 8)}`;
const seededIds: number[] = [];

function asAdmin() {
  sessionMock.current = sessionUser(`user-${runId}-admin`, "admin");
}
function asAuthor() {
  sessionMock.current = sessionUser(`user-${runId}-author`, "author");
}
const { noSession } = sessionSetters(sessionMock);

afterAll(async () => {
  await testDb.delete(categories).where(inArray(categories.id, seededIds));
  await pool.end();
});

describe("createCategory", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(await createCategory(`${runId} Author Attempt`)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    noSession();
    expect(await createCategory(`${runId} No Session Attempt`)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("rejects invalid input", async () => {
    asAdmin();
    expect(await createCategory("")).toEqual({
      ok: false,
      error: "Invalid category name.",
    });
  });

  it("creates a category as admin", async () => {
    asAdmin();
    const result = await createCategory(`${runId} NHL`);
    expect(result.ok).toBe(true);
    if (result.ok) seededIds.push(result.data.id);
  });
});

describe("updateCategory", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(await updateCategory(1, { name: "x" })).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    noSession();
    expect(await updateCategory(1, { name: "x" })).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("rejects invalid input", async () => {
    asAdmin();
    expect(await updateCategory(1, {})).toEqual({
      ok: false,
      error: "No changes to save.",
    });
    expect(await updateCategory("not-an-id", { name: "x" })).toEqual({
      ok: false,
      error: "Invalid category.",
    });
  });

  it("updates a category as admin", async () => {
    asAdmin();
    const created = await createCategory(`${runId} MLS`);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    seededIds.push(created.data.id);

    const result = await updateCategory(created.data.id, {
      name: `${runId} MLS Renamed`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe(`${runId} MLS Renamed`);
    expect(result.data.slug).toBe(created.data.slug);
  });
});
