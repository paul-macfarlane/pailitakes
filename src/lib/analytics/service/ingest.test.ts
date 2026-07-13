import { beforeEach, describe, expect, it, vi } from "vitest";

// No real DB needed: recordPageView's only DB dependency (insertPageView) is
// mocked directly, mirroring how create.test.ts mocks moderateComment for a
// network-calling dependency — env.ts is mocked too (parses process.env at
// import time, not populated under an isolated vitest run, same reasoning as
// src/lib/comments/service/create.test.ts).
const envMock = vi.hoisted(() => ({ ANALYTICS_SALT_SEED: "x".repeat(16) }));
vi.mock("@/lib/shared/env", () => ({ env: envMock }));

const isKnownBotUserAgentMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/bot", () => ({
  isKnownBotUserAgent: isKnownBotUserAgentMock,
}));

const insertPageViewMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/data", () => ({
  InsertPageViewResult: { Inserted: "inserted", UnknownPost: "unknown-post" },
  insertPageView: insertPageViewMock,
}));

const { recordPageView, PageViewIngestStatus } = await import("./ingest");

const BASE = {
  path: "/posts/some-slug",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
};

describe("recordPageView", () => {
  beforeEach(() => {
    envMock.ANALYTICS_SALT_SEED = "x".repeat(16);
    isKnownBotUserAgentMock.mockReset().mockReturnValue(false);
    insertPageViewMock.mockReset().mockResolvedValue("inserted");
  });

  it("is Disabled and never inserts when ANALYTICS_SALT_SEED is unset", async () => {
    envMock.ANALYTICS_SALT_SEED = "";
    const result = await recordPageView(BASE);
    expect(result).toBe(PageViewIngestStatus.Disabled);
    expect(insertPageViewMock).not.toHaveBeenCalled();
  });

  it("is Dropped for a known bot UA, without inserting", async () => {
    isKnownBotUserAgentMock.mockReturnValue(true);
    const result = await recordPageView(BASE);
    expect(result).toBe(PageViewIngestStatus.Dropped);
    expect(insertPageViewMock).not.toHaveBeenCalled();
  });

  it("is Dropped (not an error) when the post id is stale (UnknownPost)", async () => {
    insertPageViewMock.mockResolvedValue("unknown-post");
    const result = await recordPageView({
      ...BASE,
      postId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result).toBe(PageViewIngestStatus.Dropped);
  });

  it("is Recorded on success, inserting a 64-hex visitorHash and a null-normalized postId", async () => {
    const result = await recordPageView(BASE);
    expect(result).toBe(PageViewIngestStatus.Recorded);
    expect(insertPageViewMock).toHaveBeenCalledTimes(1);
    const call = insertPageViewMock.mock.calls[0][0];
    expect(call.path).toBe(BASE.path);
    expect(call.postId).toBeNull();
    expect(call.visitorHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes the postId through when provided", async () => {
    const postId = "11111111-1111-4111-8111-111111111111";
    await recordPageView({ ...BASE, postId });
    expect(insertPageViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ postId }),
    );
  });
});
