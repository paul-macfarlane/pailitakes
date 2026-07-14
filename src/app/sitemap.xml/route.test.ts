import { describe, expect, it, vi } from "vitest";

// Route-handler wiring test (mirrors src/app/api/cron/revalidate/route.test.ts):
// mock the query the route delegates to and next/cache's "use cache" primitives
// (unavailable outside a real Next.js cacheComponents runtime — cacheTag/
// cacheLife throw under Vitest otherwise). The visibility predicate itself is
// unit-tested in src/lib/posts/posts.test.ts.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

const envMock = vi.hoisted(() => ({
  BETTER_AUTH_URL: "https://paulitakes.com",
}));
vi.mock("@/lib/shared/env", () => ({ env: envMock }));

const listVisiblePostsForSitemapMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posts/posts", () => ({
  listVisiblePostsForSitemap: listVisiblePostsForSitemapMock,
}));

const { GET } = await import("./route");

describe("GET /sitemap.xml", () => {
  it("renders the home url plus one per post, contentUpdatedAt falling back to publishAt", async () => {
    listVisiblePostsForSitemapMock.mockResolvedValue([
      {
        slug: "alpha",
        publishAt: new Date("2026-01-01T00:00:00.000Z"),
        contentUpdatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        slug: "beta",
        publishAt: new Date("2026-02-01T00:00:00.000Z"),
        contentUpdatedAt: null,
      },
    ]);

    const res = await GET();
    const body = await res.text();

    expect(res.headers.get("Content-Type")).toBe("application/xml");
    expect(body).toContain("<loc>https://paulitakes.com/</loc>");
    expect(body).toContain(
      "<url><loc>https://paulitakes.com/posts/alpha</loc><lastmod>2026-01-05T00:00:00.000Z</lastmod></url>",
    );
    expect(body).toContain(
      "<url><loc>https://paulitakes.com/posts/beta</loc><lastmod>2026-02-01T00:00:00.000Z</lastmod></url>",
    );
  });

  it("XML-escapes & in a loc value", async () => {
    listVisiblePostsForSitemapMock.mockResolvedValue([
      {
        slug: "foo&bar",
        publishAt: new Date("2026-01-01T00:00:00.000Z"),
        contentUpdatedAt: null,
      },
    ]);

    const res = await GET();
    const body = await res.text();

    expect(body).toContain(
      "<loc>https://paulitakes.com/posts/foo&amp;bar</loc>",
    );
    expect(body).not.toContain("foo&bar");
  });
});
