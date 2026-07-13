import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-handler wiring test (mirrors src/app/api/comments/route.test.ts):
// mock the service the route delegates to, and cover 401/403/200/degrade.
// Session is mocked so the route's getSession() call never touches the real
// Better Auth instance (which requires env vars this isolated run doesn't
// set).
const getAnalyticsSummaryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/service/aggregates", () => ({
  getAnalyticsSummary: getAnalyticsSummaryMock,
}));

const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
}));

const { GET } = await import("./route");
const { NOT_AUTHORIZED_ERROR } = await import("@/lib/shared/action-result");
const { AnalyticsGranularity, AnalyticsRange } =
  await import("@/lib/analytics/input");

function request(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/admin/analytics");
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

const PAYLOAD = { traffic: [], categories: [], posts: [] };

describe("GET /api/admin/analytics", () => {
  beforeEach(() => {
    sessionMock.current = null;
    getAnalyticsSummaryMock.mockReset();
  });

  it("401s an anonymous request without calling the service", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(getAnalyticsSummaryMock).not.toHaveBeenCalled();
  });

  it("403s when the service reports not-authorized (e.g. a signed-in non-admin)", async () => {
    sessionMock.current = { user: { id: "user-1", role: "reader" } };
    getAnalyticsSummaryMock.mockResolvedValue({
      ok: false,
      error: NOT_AUTHORIZED_ERROR,
    });
    const res = await GET(request());
    expect(res.status).toBe(403);
  });

  it("200s with the assembled payload for an admin", async () => {
    sessionMock.current = { user: { id: "admin-1", role: "admin" } };
    getAnalyticsSummaryMock.mockResolvedValue({ ok: true, data: PAYLOAD });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PAYLOAD);
  });

  it("passes parsed range/granularity through to the service", async () => {
    sessionMock.current = { user: { id: "admin-1", role: "admin" } };
    getAnalyticsSummaryMock.mockResolvedValue({ ok: true, data: PAYLOAD });
    await GET(
      request({
        range: AnalyticsRange.Quarter,
        granularity: AnalyticsGranularity.Week,
      }),
    );
    expect(getAnalyticsSummaryMock).toHaveBeenCalledWith(
      { id: "admin-1", role: "admin" },
      { range: AnalyticsRange.Quarter, granularity: AnalyticsGranularity.Week },
    );
  });

  it("degrades garbage range/granularity to defaults instead of 400ing", async () => {
    sessionMock.current = { user: { id: "admin-1", role: "admin" } };
    getAnalyticsSummaryMock.mockResolvedValue({ ok: true, data: PAYLOAD });
    const res = await GET(
      request({ range: "not-a-range", granularity: "not-a-granularity" }),
    );
    expect(res.status).toBe(200);
    expect(getAnalyticsSummaryMock).toHaveBeenCalledWith(
      { id: "admin-1", role: "admin" },
      { range: AnalyticsRange.Month, granularity: undefined },
    );
  });
});
