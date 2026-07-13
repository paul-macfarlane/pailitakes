import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks src/lib/analytics/data.ts directly (mirrors src/lib/analytics/
// service/ingest.test.ts) rather than a real DB — canPerformAction is pure
// and the data-layer SQL shape is proven by the real-Postgres integration
// coverage in src/lib/analytics/data.test.ts, so this test only needs to
// prove the service's gating/defaulting/assembly logic.
const countViewsByBucketMock = vi.hoisted(() => vi.fn());
const countViewsByCategoryMock = vi.hoisted(() => vi.fn());
const viewsAndEngagementByPostMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/data", () => ({
  countViewsByBucket: countViewsByBucketMock,
  countViewsByCategory: countViewsByCategoryMock,
  viewsAndEngagementByPost: viewsAndEngagementByPostMock,
}));

const { getAnalyticsSummary } = await import("./aggregates");
const { NOT_AUTHORIZED_ERROR } = await import("@/lib/shared/action-result");
const { AnalyticsRange, AnalyticsGranularity } =
  await import("@/lib/analytics/input");

const ADMIN = { role: "admin", bannedAt: null as Date | null };
const READER = { role: "reader", bannedAt: null as Date | null };

const TRAFFIC = [{ bucket: "2026-07-01", views: 10, uniques: 5 }];
const CATEGORIES = [{ categoryId: 1, name: "News", views: 10 }];
const POSTS = [
  {
    postId: "post-1",
    title: "Post",
    slug: "post",
    views: 10,
    comments: 2,
    likes: 1,
  },
];

describe("getAnalyticsSummary", () => {
  beforeEach(() => {
    countViewsByBucketMock.mockReset().mockResolvedValue(TRAFFIC);
    countViewsByCategoryMock.mockReset().mockResolvedValue(CATEGORIES);
    viewsAndEngagementByPostMock.mockReset().mockResolvedValue(POSTS);
  });

  it("rejects a non-admin caller (reader) without querying data.ts", async () => {
    const result = await getAnalyticsSummary(READER, {
      range: AnalyticsRange.Month,
    });
    expect(result).toEqual({ ok: false, error: NOT_AUTHORIZED_ERROR });
    expect(countViewsByBucketMock).not.toHaveBeenCalled();
  });

  it("rejects a banned admin without querying data.ts", async () => {
    const result = await getAnalyticsSummary(
      { ...ADMIN, bannedAt: new Date() },
      { range: AnalyticsRange.Month },
    );
    expect(result).toEqual({ ok: false, error: NOT_AUTHORIZED_ERROR });
    expect(countViewsByBucketMock).not.toHaveBeenCalled();
  });

  it("assembles traffic/categories/posts for an authorized admin", async () => {
    const result = await getAnalyticsSummary(ADMIN, {
      range: AnalyticsRange.Month,
    });
    expect(result).toEqual({
      ok: true,
      data: { traffic: TRAFFIC, categories: CATEGORIES, posts: POSTS },
    });
  });

  it.each([
    [AnalyticsRange.Week, AnalyticsGranularity.Day],
    [AnalyticsRange.Month, AnalyticsGranularity.Day],
    [AnalyticsRange.Quarter, AnalyticsGranularity.Week],
    [AnalyticsRange.All, AnalyticsGranularity.Month],
  ])("defaults granularity for range %s to %s", async (range, expected) => {
    await getAnalyticsSummary(ADMIN, { range });
    expect(countViewsByBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: expected }),
    );
  });

  it("uses the caller-supplied granularity instead of the range default", async () => {
    await getAnalyticsSummary(ADMIN, {
      range: AnalyticsRange.Week,
      granularity: AnalyticsGranularity.Month,
    });
    expect(countViewsByBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: AnalyticsGranularity.Month }),
    );
  });

  it("computes `since` from the passed-in `now` (7d range = now - 7 days)", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const expectedSince = new Date("2026-07-05T12:00:00.000Z");

    await getAnalyticsSummary(ADMIN, { range: AnalyticsRange.Week }, now);

    expect(countViewsByBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({ since: expectedSince }),
    );
    expect(countViewsByCategoryMock).toHaveBeenCalledWith({
      since: expectedSince,
    });
    expect(viewsAndEngagementByPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ since: expectedSince }),
    );
  });

  it("passes since=null for the 'all' range", async () => {
    await getAnalyticsSummary(ADMIN, { range: AnalyticsRange.All });
    expect(countViewsByBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({ since: null }),
    );
  });
});
