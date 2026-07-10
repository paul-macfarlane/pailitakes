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
import { sessionUser } from "@/test/helpers";

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

const { setUserRole, setUserBanned } = await import("./users");

const { user } = schema;

const runId = `t-adm10a-${crypto.randomUUID().slice(0, 8)}`;
const adminAId = `user-${runId}-adminA`;
const adminBId = `user-${runId}-adminB`;
const authorId = `user-${runId}-author`;
const readerId = `user-${runId}-reader`;
const ALL = [adminAId, adminBId, authorId, readerId];

function asAdmin() {
  sessionMock.current = sessionUser(adminAId, "admin");
}
function asAuthor() {
  sessionMock.current = sessionUser(authorId, "author");
}
function noSession() {
  sessionMock.current = null;
}

async function roleOf(id: string) {
  const [row] = await testDb
    .select({ role: user.role, bannedAt: user.bannedAt })
    .from(user)
    .where(eq(user.id, id));
  return row!;
}

beforeAll(async () => {
  await testDb.delete(user).where(inArray(user.id, ALL));
});

beforeEach(async () => {
  // Reset to a known state before each case (roles/bans get mutated).
  await testDb.delete(user).where(inArray(user.id, ALL));
  await testDb.insert(user).values([
    {
      id: adminAId,
      name: `AdminA ${runId}`,
      email: `a-${runId}@e.com`,
      role: "admin",
    },
    {
      id: adminBId,
      name: `AdminB ${runId}`,
      email: `b-${runId}@e.com`,
      role: "admin",
    },
    {
      id: authorId,
      name: `Author ${runId}`,
      email: `au-${runId}@e.com`,
      role: "author",
    },
    {
      id: readerId,
      name: `Reader ${runId}`,
      email: `r-${runId}@e.com`,
      role: "reader",
    },
  ]);
});

afterAll(async () => {
  await testDb.delete(user).where(inArray(user.id, ALL));
  await pool.end();
});

describe("setUserRole", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(await setUserRole(readerId, "author")).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    noSession();
    expect(await setUserRole(readerId, "author")).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect((await roleOf(readerId)).role).toBe("reader");
  });

  it("validates the role and the user id", async () => {
    asAdmin();
    expect(await setUserRole(readerId, "superuser")).toEqual({
      ok: false,
      error: "Invalid role.",
    });
    expect(await setUserRole("", "author")).toEqual({
      ok: false,
      error: "Invalid user.",
    });
  });

  it("returns 'User not found.' for an unknown id", async () => {
    asAdmin();
    expect(await setUserRole(`user-${runId}-ghost`, "author")).toEqual({
      ok: false,
      error: "User not found.",
    });
  });

  it("promotes a reader to author", async () => {
    asAdmin();
    const result = await setUserRole(readerId, "author");
    expect(result.ok).toBe(true);
    expect((await roleOf(readerId)).role).toBe("author");
  });

  it("demotes another admin while an admin remains", async () => {
    asAdmin();
    const result = await setUserRole(adminBId, "author");
    expect(result.ok).toBe(true);
    expect((await roleOf(adminBId)).role).toBe("author");
  });

  it("is a no-op when the role is unchanged", async () => {
    asAdmin();
    expect(await setUserRole(readerId, "reader")).toEqual({
      ok: true,
      data: { id: readerId, role: "reader" },
    });
  });
});

describe("setUserBanned", () => {
  it("rejects a non-admin caller", async () => {
    asAuthor();
    expect(await setUserBanned(readerId, true)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect((await roleOf(readerId)).bannedAt).toBeNull();
  });

  it("validates the banned flag", async () => {
    asAdmin();
    expect(await setUserBanned(readerId, "yes")).toEqual({
      ok: false,
      error: "Invalid request.",
    });
  });

  it("bans then unbans a user", async () => {
    asAdmin();
    const banned = await setUserBanned(readerId, true);
    expect(banned).toEqual({ ok: true, data: { id: readerId, banned: true } });
    expect((await roleOf(readerId)).bannedAt).not.toBeNull();

    const unbanned = await setUserBanned(readerId, false);
    expect(unbanned).toEqual({
      ok: true,
      data: { id: readerId, banned: false },
    });
    expect((await roleOf(readerId)).bannedAt).toBeNull();
  });

  it("bans another admin while an admin remains", async () => {
    asAdmin();
    const result = await setUserBanned(adminBId, true);
    expect(result.ok).toBe(true);
    expect((await roleOf(adminBId)).bannedAt).not.toBeNull();
  });

  it("is a no-op when already in the requested state", async () => {
    asAdmin();
    expect(await setUserBanned(readerId, false)).toEqual({
      ok: true,
      data: { id: readerId, banned: false },
    });
  });
});
