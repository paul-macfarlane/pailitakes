import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-handler wiring test (mirrors src/app/api/cron/revalidate/route.test.ts
// and src/app/api/comments/route.test.ts): mock the service the route
// delegates to and cover status-code wiring only — recordPageView's own
// logic is unit-tested in src/lib/analytics/service/ingest.test.ts.
const recordPageViewMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/service/ingest", () => ({
  PageViewIngestStatus: {
    Recorded: "recorded",
    Dropped: "dropped",
    Disabled: "disabled",
  },
  recordPageView: recordPageViewMock,
}));

const { POST } = await import("./route");

function request(
  body: unknown,
  init: { headers?: Record<string, string>; raw?: string } = {},
) {
  return new Request("http://localhost/api/view", {
    method: "POST",
    body: init.raw !== undefined ? init.raw : JSON.stringify(body),
    headers: init.headers,
  });
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/view", () => {
  beforeEach(() => {
    recordPageViewMock.mockReset().mockResolvedValue("recorded");
  });

  it("400s on malformed JSON without calling the service", async () => {
    const res = await POST(request(undefined, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(recordPageViewMock).not.toHaveBeenCalled();
  });

  it("400s on a bad path (not starting with /)", async () => {
    const res = await POST(request({ path: "posts/slug" }));
    expect(res.status).toBe(400);
    expect(recordPageViewMock).not.toHaveBeenCalled();
  });

  it("400s on a bad postId", async () => {
    const res = await POST(request({ path: "/", postId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(recordPageViewMock).not.toHaveBeenCalled();
  });

  it("204s on success, passing path/postId/ip/userAgent through", async () => {
    const res = await POST(
      request(
        { path: "/posts/slug", postId: VALID_UUID },
        {
          headers: {
            "user-agent": "Mozilla/5.0 (test)",
            "x-forwarded-for": "203.0.113.7, 10.0.0.1",
          },
        },
      ),
    );
    expect(res.status).toBe(204);
    expect(recordPageViewMock).toHaveBeenCalledWith({
      path: "/posts/slug",
      postId: VALID_UUID,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
    });
  });

  it("204s on a bot UA (service mocked to Dropped) — indistinguishable from success", async () => {
    recordPageViewMock.mockResolvedValue("dropped");
    const res = await POST(request({ path: "/" }));
    expect(res.status).toBe(204);
  });

  it("503s when the service reports Disabled", async () => {
    recordPageViewMock.mockResolvedValue("disabled");
    const res = await POST(request({ path: "/" }));
    expect(res.status).toBe(503);
  });
});
