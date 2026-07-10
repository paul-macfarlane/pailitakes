import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const { pool, testDb } = await vi.hoisted(async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
});

vi.mock("@/db", () => ({ db: testDb }));

const { listUsers, wouldOrphanAdmins } = await import("./admin-users");

const { user } = schema;

const runId = `t-adm10u-${crypto.randomUUID().slice(0, 8)}`;
const readerId = `user-${runId}-reader`;
const authorId = `user-${runId}-author`;
const adminId = `user-${runId}-admin`;

beforeAll(async () => {
  await testDb
    .delete(user)
    .where(inArray(user.id, [readerId, authorId, adminId]));
  await testDb.insert(user).values([
    {
      id: readerId,
      name: `Reader ${runId}`,
      email: `reader-${runId}@example.com`,
      role: "reader",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: authorId,
      name: `Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "author",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
    {
      id: adminId,
      name: `Admin ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    },
  ]);
});

afterAll(async () => {
  await testDb
    .delete(user)
    .where(inArray(user.id, [readerId, authorId, adminId]));
  await pool.end();
});

describe("wouldOrphanAdmins", () => {
  it("is true only when the target is the sole admin", () => {
    expect(wouldOrphanAdmins(["a"], "a")).toBe(true);
    expect(wouldOrphanAdmins([], "a")).toBe(true);
    expect(wouldOrphanAdmins(["a", "b"], "a")).toBe(false);
    expect(wouldOrphanAdmins(["a", "b"], "b")).toBe(false);
    expect(wouldOrphanAdmins(["a", "b"], "c")).toBe(false);
  });
});

describe("listUsers", () => {
  it("filters by role", async () => {
    const { rows } = await listUsers({ role: "reader", limit: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(readerId);
    expect(ids).not.toContain(adminId);
    expect(rows.every((r) => r.role === "reader")).toBe(true);
  });

  it("returns the seeded users newest-first", async () => {
    const { rows } = await listUsers({ limit: 100 });
    const mine = rows
      .filter((r) => [readerId, authorId, adminId].includes(r.id))
      .map((r) => r.id);
    // createdAt desc: admin (Mar) > author (Feb) > reader (Jan).
    expect(mine).toEqual([adminId, authorId, readerId]);
  });

  it("reports hasMore and applies the limit", async () => {
    const { rows, hasMore } = await listUsers({ limit: 1 });
    expect(rows).toHaveLength(1);
    // The DB has more than one user (the three seeded here at minimum).
    expect(hasMore).toBe(true);
  });

  it("searches by name substring, case-insensitively", async () => {
    // The runId is embedded in every seeded name, and uppercasing it proves
    // the match is case-insensitive (ilike).
    const { rows } = await listUsers({ q: runId.toUpperCase(), limit: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([readerId, authorId, adminId]));
  });

  it("searches by email substring", async () => {
    // `reader-${runId}` appears in the reader's email but not in any seeded
    // name (names use a space: "Reader ${runId}"), so this isolates email.
    const { rows } = await listUsers({ q: `reader-${runId}`, limit: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(readerId);
    expect(ids).not.toContain(authorId);
    expect(ids).not.toContain(adminId);
  });

  it("combines the role filter with search", async () => {
    const { rows } = await listUsers({
      role: "author",
      q: runId,
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(authorId);
    expect(ids).not.toContain(readerId);
    expect(ids).not.toContain(adminId);
  });

  it("exposes the fields the screen renders", async () => {
    const { rows } = await listUsers({ role: "admin", limit: 100 });
    const admin = rows.find((r) => r.id === adminId);
    expect(admin).toMatchObject({
      email: `admin-${runId}@example.com`,
      role: "admin",
      bannedAt: null,
    });
    expect(admin?.createdAt).toBeInstanceOf(Date);
  });
});
