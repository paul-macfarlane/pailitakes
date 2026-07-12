import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { sessionSetters, sessionUser } from "@/test/helpers";

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// one pool/db serves both the mocked "@/db" (used by the actions under
// test) and the seeding/cleanup code here. Same structure as
// src/actions/categories.test.ts.
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

const { createAnnouncement, deleteAnnouncement, updateAnnouncement } =
  await import("./announcements");
const { revalidateTag } = await import("next/cache");

const { announcements } = schema;

const runId = `t-ann-act-${crypto.randomUUID().slice(0, 8)}`;
const seededIds: string[] = [];

function asAdmin() {
  sessionMock.current = sessionUser(`user-${runId}-admin`, "admin");
}
function asAuthor() {
  sessionMock.current = sessionUser(`user-${runId}-author`, "author");
}
const { noSession } = sessionSetters(sessionMock);

afterAll(async () => {
  await testDb
    .delete(announcements)
    .where(inArray(announcements.id, seededIds));
  await pool.end();
});

describe("createAnnouncement", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(
      await createAnnouncement({
        body: `${runId} author attempt`,
        expiresAt: null,
      }),
    ).toEqual({ ok: false, error: "Not authorized." });
    noSession();
    expect(
      await createAnnouncement({
        body: `${runId} no session`,
        expiresAt: null,
      }),
    ).toEqual({ ok: false, error: "Not authorized." });
  });

  it("rejects an unauthorized caller with invalid input before parsing (guard-before-parse)", async () => {
    asAuthor();
    expect(await createAnnouncement({ body: "", expiresAt: null })).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("rejects invalid input as admin", async () => {
    asAdmin();
    expect(await createAnnouncement({ body: "", expiresAt: null })).toEqual({
      ok: false,
      error: "Announcement body is required.",
    });
  });

  it("creates an announcement as admin", async () => {
    asAdmin();
    vi.mocked(revalidateTag).mockClear();
    const result = await createAnnouncement({
      body: `  ${runId} created  `,
      expiresAt: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    seededIds.push(result.data.id);

    const [row] = await testDb
      .select()
      .from(announcements)
      .where(inArray(announcements.id, [result.data.id]));
    // Input schema trims the body — confirms the action delegated the
    // parsed (not raw) value to the service.
    expect(row).toMatchObject({ body: `${runId} created`, expiresAt: null });
    expect(revalidateTag).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });
});

describe("updateAnnouncement", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(
      await updateAnnouncement("00000000-0000-4000-8000-000000000000", {
        body: `${runId} author attempt`,
        expiresAt: null,
      }),
    ).toEqual({ ok: false, error: "Not authorized." });
    noSession();
    expect(
      await updateAnnouncement("00000000-0000-4000-8000-000000000000", {
        body: `${runId} no session`,
        expiresAt: null,
      }),
    ).toEqual({ ok: false, error: "Not authorized." });
  });

  it("rejects an unauthorized caller with invalid input before parsing (guard-before-parse)", async () => {
    asAuthor();
    expect(
      await updateAnnouncement("not-a-uuid", { body: "", expiresAt: null }),
    ).toEqual({ ok: false, error: "Not authorized." });
  });

  it("rejects an invalid id as admin", async () => {
    asAdmin();
    expect(
      await updateAnnouncement("not-a-uuid", {
        body: `${runId} x`,
        expiresAt: null,
      }),
    ).toEqual({ ok: false, error: "Invalid UUID" });
  });

  it("updates an announcement as admin", async () => {
    asAdmin();
    const created = await createAnnouncement({
      body: `${runId} to update`,
      expiresAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    seededIds.push(created.data.id);

    vi.mocked(revalidateTag).mockClear();
    const result = await updateAnnouncement(created.data.id, {
      body: `${runId} updated`,
      expiresAt: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await testDb
      .select()
      .from(announcements)
      .where(inArray(announcements.id, [created.data.id]));
    expect(row).toMatchObject({ body: `${runId} updated` });
    expect(revalidateTag).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });
});

describe("deleteAnnouncement", () => {
  it("rejects a non-admin and an unauthenticated caller", async () => {
    asAuthor();
    expect(
      await deleteAnnouncement("00000000-0000-4000-8000-000000000000"),
    ).toEqual({ ok: false, error: "Not authorized." });
    noSession();
    expect(
      await deleteAnnouncement("00000000-0000-4000-8000-000000000000"),
    ).toEqual({ ok: false, error: "Not authorized." });
  });

  it("rejects an unauthorized caller with invalid input before parsing (guard-before-parse)", async () => {
    asAuthor();
    expect(await deleteAnnouncement("not-a-uuid")).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("rejects an invalid id as admin", async () => {
    asAdmin();
    expect(await deleteAnnouncement("not-a-uuid")).toEqual({
      ok: false,
      error: "Invalid UUID",
    });
  });

  it("deletes an announcement as admin", async () => {
    asAdmin();
    const created = await createAnnouncement({
      body: `${runId} to delete`,
      expiresAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    vi.mocked(revalidateTag).mockClear();
    const result = await deleteAnnouncement(created.data.id);
    expect(result).toEqual({ ok: true, data: { id: created.data.id } });

    const [row] = await testDb
      .select()
      .from(announcements)
      .where(inArray(announcements.id, [created.data.id]));
    expect(row).toBeUndefined();
    expect(revalidateTag).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });
});
