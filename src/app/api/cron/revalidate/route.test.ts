import { beforeEach, describe, expect, it, vi } from "vitest";

// Settable env + mocked collaborators — this test covers the auth/wiring of
// the route; the crossing logic is tested in src/lib/revalidation.test.ts.
const envMock = vi.hoisted(() => ({
  CRON_SECRET: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

const crossedMock = vi.hoisted(() => ({
  fn: vi.fn<(now: Date) => Promise<string[]>>(),
}));
const advanceMock = vi.hoisted(() => ({
  fn: vi.fn<(now: Date) => Promise<void>>(),
}));
const normalizeMock = vi.hoisted(() => ({
  fn: vi.fn<(now: Date) => Promise<number>>(),
}));
vi.mock("@/lib/revalidation", () => ({
  getCrossedSlugs: crossedMock.fn,
  advanceRevalidationMarker: advanceMock.fn,
  normalizePostStatuses: normalizeMock.fn,
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { GET } = await import("./route");
const { revalidateTag } = await import("next/cache");

const SECRET = "test-cron-secret-1234";

function request(auth?: string) {
  return new Request("http://localhost/api/cron/revalidate", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  envMock.CRON_SECRET = SECRET;
  crossedMock.fn.mockReset().mockResolvedValue([]);
  advanceMock.fn.mockReset().mockResolvedValue(undefined);
  normalizeMock.fn.mockReset().mockResolvedValue(0);
  vi.mocked(revalidateTag).mockClear();
});

describe("GET /api/cron/revalidate", () => {
  it("503s when CRON_SECRET is not configured", async () => {
    envMock.CRON_SECRET = undefined;
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(crossedMock.fn).not.toHaveBeenCalled();
  });

  it("401s a missing or wrong bearer token", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(crossedMock.fn).not.toHaveBeenCalled();
    expect(advanceMock.fn).not.toHaveBeenCalled();
  });

  it("revalidates each crossed post + post-list, then advances the marker", async () => {
    crossedMock.fn.mockResolvedValue(["alpha", "beta"]);
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revalidated: 2 });
    expect(revalidateTag).toHaveBeenCalledWith("post:alpha", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith("post:beta", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());

    // Marker advances AFTER revalidation (finding: at-least-once ordering).
    const lastRevalidate = Math.max(
      ...vi.mocked(revalidateTag).mock.invocationCallOrder,
    );
    expect(advanceMock.fn.mock.invocationCallOrder[0]).toBeGreaterThan(
      lastRevalidate,
    );
  });

  it("advances the marker even when nothing crossed (no post-list churn)", async () => {
    crossedMock.fn.mockResolvedValue([]);
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revalidated: 0 });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(advanceMock.fn).toHaveBeenCalledOnce();
  });

  it("normalizes stored statuses before advancing the marker and reports the count separately", async () => {
    normalizeMock.fn.mockResolvedValue(3);
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(normalizeMock.fn).toHaveBeenCalledOnce();
    // Reported separately from `revalidated` (status bookkeeping, not cache
    // invalidation), so it never inflates the revalidation count.
    expect(await res.json()).toMatchObject({ revalidated: 0, normalized: 3 });
    // Normalize must land before the marker advances (same window discipline
    // as revalidation).
    expect(normalizeMock.fn.mock.invocationCallOrder[0]).toBeLessThan(
      advanceMock.fn.mock.invocationCallOrder[0]!,
    );
  });
});
