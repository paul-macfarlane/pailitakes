import { beforeEach, describe, expect, it, vi } from "vitest";

// Unlike most domain service tests (which hit a real test DB via a mocked
// "@/db"), this domain's mutations are thin enough to unit-test against a
// fully mocked data module — same precedent as
// src/lib/comments/service/moderation-log.test.ts mocking @/lib/comments/data
// for deterministic, DB-independent assertions.
const insertAnnouncementMock = vi.hoisted(() => vi.fn());
const updateAnnouncementRowMock = vi.hoisted(() => vi.fn());
const deleteAnnouncementRowMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/announcements/data", () => ({
  insertAnnouncement: insertAnnouncementMock,
  updateAnnouncementRow: updateAnnouncementRowMock,
  deleteAnnouncementRow: deleteAnnouncementRowMock,
}));

const revalidateTagMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag: revalidateTagMock }));

const { createAnnouncement, deleteAnnouncement, updateAnnouncement } =
  await import("./service");

const ANNOUNCEMENT_ID = "11111111-1111-4111-8111-111111111111";
const ROW = {
  id: ANNOUNCEMENT_ID,
  body: "Big news!",
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  insertAnnouncementMock.mockReset();
  updateAnnouncementRowMock.mockReset();
  deleteAnnouncementRowMock.mockReset();
  revalidateTagMock.mockReset();
});

describe("createAnnouncement", () => {
  it("inserts and revalidates the announcements tag on success", async () => {
    insertAnnouncementMock.mockResolvedValue(ROW);

    const result = await createAnnouncement({
      body: "Big news!",
      expiresAt: null,
    });

    expect(result).toEqual({ ok: true, data: { id: ANNOUNCEMENT_ID } });
    expect(insertAnnouncementMock).toHaveBeenCalledWith({
      body: "Big news!",
      expiresAt: null,
    });
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });

  it("returns a generic error and does not revalidate when the data layer throws", async () => {
    insertAnnouncementMock.mockRejectedValue(new Error("db down"));

    const result = await createAnnouncement({
      body: "Big news!",
      expiresAt: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});

describe("updateAnnouncement", () => {
  it("updates and revalidates the announcements tag on success", async () => {
    updateAnnouncementRowMock.mockResolvedValue(ROW);

    const result = await updateAnnouncement(ANNOUNCEMENT_ID, {
      body: "Updated news!",
      expiresAt: null,
    });

    expect(result).toEqual({ ok: true, data: { id: ANNOUNCEMENT_ID } });
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });

  it("returns not-found without revalidating when the row doesn't exist", async () => {
    updateAnnouncementRowMock.mockResolvedValue(undefined);

    const result = await updateAnnouncement(ANNOUNCEMENT_ID, {
      body: "Updated news!",
      expiresAt: null,
    });

    expect(result).toEqual({ ok: false, error: "Announcement not found." });
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("returns a generic error and does not revalidate when the data layer throws", async () => {
    updateAnnouncementRowMock.mockRejectedValue(new Error("db down"));

    const result = await updateAnnouncement(ANNOUNCEMENT_ID, {
      body: "Updated news!",
      expiresAt: null,
    });

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});

describe("deleteAnnouncement", () => {
  it("deletes and revalidates the announcements tag on success", async () => {
    deleteAnnouncementRowMock.mockResolvedValue(true);

    const result = await deleteAnnouncement(ANNOUNCEMENT_ID);

    expect(result).toEqual({ ok: true, data: { id: ANNOUNCEMENT_ID } });
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "announcements",
      expect.anything(),
    );
  });

  it("returns not-found without revalidating when the row doesn't exist", async () => {
    deleteAnnouncementRowMock.mockResolvedValue(false);

    const result = await deleteAnnouncement(ANNOUNCEMENT_ID);

    expect(result).toEqual({ ok: false, error: "Announcement not found." });
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("returns a generic error and does not revalidate when the data layer throws", async () => {
    deleteAnnouncementRowMock.mockRejectedValue(new Error("db down"));

    const result = await deleteAnnouncement(ANNOUNCEMENT_ID);

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});
