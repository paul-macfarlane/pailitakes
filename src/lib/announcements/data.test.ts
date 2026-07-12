import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

// vi.hoisted lifts this above the mock factory (TDZ otherwise) — same
// pattern as src/lib/comments/data.test.ts: one pool/db serves both the
// mocked "@/db" (used by data.ts) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const { listActiveAnnouncements, listAllAnnouncements } =
  await import("./data");

const { announcements } = schema;

// Announcements have no FKs, so seeding is plain inserts scoped by this
// prefix — other suites don't touch this table, but the prefix still keeps
// afterAll cleanup exact and self-describing.
const SEED_PREFIX = "t-ann-data-";
const runId = `${SEED_PREFIX}${crypto.randomUUID().slice(0, 8)}`;

const NOW = new Date("2026-02-01T12:00:00Z");
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000);

const seededIds: string[] = [];

beforeAll(async () => {
  const rows = await testDb
    .insert(announcements)
    .values([
      {
        // expiresAt: null → always active.
        body: `${runId} no-expiry`,
        expiresAt: null,
        createdAt: seconds(-40),
      },
      {
        // expiresAt in the future relative to NOW → active.
        body: `${runId} future-expiry`,
        expiresAt: seconds(60),
        createdAt: seconds(-30),
      },
      {
        // expiresAt exactly NOW → hidden (strict `>` comparison, not `>=`).
        body: `${runId} expires-at-now`,
        expiresAt: NOW,
        createdAt: seconds(-20),
      },
      {
        // expiresAt in the past relative to NOW → hidden.
        body: `${runId} past-expiry`,
        expiresAt: seconds(-10),
        createdAt: seconds(-10),
      },
      {
        // Extra active rows so the limit test has 4+ active candidates to
        // pick the newest 3 from.
        body: `${runId} active-2`,
        expiresAt: null,
        createdAt: seconds(-5),
      },
      {
        body: `${runId} active-3`,
        expiresAt: null,
        createdAt: seconds(-1),
      },
    ])
    .returning({ id: announcements.id });
  seededIds.push(...rows.map((row) => row.id));
});

afterAll(async () => {
  await testDb
    .delete(announcements)
    .where(inArray(announcements.id, seededIds));
  await pool.end();
});

// Filter helper: other suites don't share this table today, but scoping
// assertions to our own seed prefix keeps this test resilient if that
// changes (mirrors src/lib/comments/data.test.ts's scoping discipline).
function ownRows<T extends { body: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.body.startsWith(runId));
}

describe("listActiveAnnouncements", () => {
  it.each([
    ["no expiresAt (null)", `${runId} no-expiry`, true],
    ["expiresAt after now", `${runId} future-expiry`, true],
    ["expiresAt exactly now", `${runId} expires-at-now`, false],
    ["expiresAt before now", `${runId} past-expiry`, false],
  ])("%s → shown=%s", async (_desc, body, shown) => {
    const rows = ownRows(await listActiveAnnouncements(1000, NOW));
    const bodies = rows.map((row) => row.body);
    if (shown) {
      expect(bodies).toContain(body);
    } else {
      expect(bodies).not.toContain(body);
    }
  });

  it("orders results newest-first by createdAt", async () => {
    const rows = ownRows(await listActiveAnnouncements(1000, NOW));
    const createdAts = rows.map((row) => row.createdAt.getTime());
    expect(createdAts).toEqual([...createdAts].sort((a, b) => b - a));
  });

  it("respects the limit, returning the newest active rows", async () => {
    const rows = ownRows(await listActiveAnnouncements(3, NOW));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.body)).toEqual([
      `${runId} active-3`,
      `${runId} active-2`,
      `${runId} future-expiry`,
    ]);
  });
});

describe("listAllAnnouncements", () => {
  it("returns expired rows too, newest first", async () => {
    const rows = ownRows(await listAllAnnouncements());
    expect(rows.map((row) => row.body)).toEqual([
      `${runId} active-3`,
      `${runId} active-2`,
      `${runId} past-expiry`,
      `${runId} expires-at-now`,
      `${runId} future-expiry`,
      `${runId} no-expiry`,
    ]);
  });
});
