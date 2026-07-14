import { config } from "dotenv";
import { Pool } from "pg";
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";

import { openAdminNav } from "./helpers/interaction";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";

config({ quiet: true });

// Analytics (ANLY, design §5.6, ADR-0025): the view beacon is fire-and-forget
// sendBeacon, whose Blob payload Playwright cannot introspect
// (postDataJSON() is null) — so beacon assertions go through the DB instead:
// poll for the page_views row the beacon inserts (a row existing IS proof of
// the whole 204 insert path). Deliberately no waitForResponse: the beacon
// fires on island hydration, which can straggle under full-suite parallel
// load, and a response listener that never matches burns the entire test
// timeout. The dashboard spec seeds synthetic rows directly (tagged visitor
// hashes) because organic traffic can't produce a deterministic multi-day
// shape.
const BEACON_POLL = { timeout: 20_000 };

// Fail fast with a diagnosable message when ingest is disabled: without
// ANALYTICS_SALT_SEED the endpoint 503s (feature off, ADR-0025) and every
// beacon spec would instead time out on an opaque "0 rows" poll. A bot UA
// makes this probe side-effect-free — 204 when enabled (dropped, no row),
// 503 when disabled.
test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/view", {
    headers: {
      "user-agent": "e2e-preflight-bot",
      "content-type": "application/json",
    },
    data: { path: "/" },
  });
  if (res.status() === 503) {
    throw new Error(
      "Analytics ingest is disabled: ANALYTICS_SALT_SEED is not set for the app under test, so beacon specs cannot pass. Set it in the environment that starts the dev server (see .env.example / .github/workflows/ci.yml).",
    );
  }
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set (see .env.example)");
  }
  return databaseUrl;
}

async function countViewsForPath(pool: Pool, path: string): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `select count(*)::int as n from page_views where path = $1`,
    [path],
  );
  return res.rows[0]!.n;
}

test("view beacon records a post pageview with its post id", async ({
  page,
}) => {
  const session = await createTestSession({ role: "author" });
  const category = await createTestCategory();
  const post = await createTestPost({
    authorId: session.userId,
    categoryId: category.id,
  });
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  const path = `/posts/${post.slug}`;
  try {
    await page.goto(path);
    // >= 1 rather than exactly 1: dev-mode HMR can remount the island and
    // legitimately re-fire (a remount IS a new pageview to the ref guard);
    // the once-per-mount contract itself is pinned by the component's shape
    // and the ingest unit tests. E2e proves the wiring: a row lands, carrying
    // the post id.
    await expect
      .poll(() => countViewsForPath(pool, path), BEACON_POLL)
      .toBeGreaterThanOrEqual(1);
    const row = await pool.query(
      `select post_id from page_views where path = $1`,
      [path],
    );
    expect(row.rows[0].post_id).toBe(post.id);
  } finally {
    await pool.query(`delete from page_views where path = $1`, [path]);
    await pool.end();
    await post.cleanup();
    await category.cleanup();
    await session.cleanup();
  }
});

test("view beacon records a home pageview without a post id", async ({
  page,
}) => {
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  try {
    const before = await countViewsForPath(pool, "/");
    await page.goto("/");
    // >= rather than exact: other concurrently-running specs may also visit
    // the home page and legitimately beacon "/".
    await expect
      .poll(() => countViewsForPath(pool, "/"), BEACON_POLL)
      .toBeGreaterThanOrEqual(before + 1);
  } finally {
    await pool.end();
  }
});

test("admin sees the analytics dashboard: charts, table, mobile fit", async ({
  page,
  context,
}) => {
  const admin = await createTestSession({ role: "admin" });
  const author = await createTestSession({ role: "author" });
  const category = await createTestCategory();
  const post = await createTestPost({
    authorId: author.userId,
    categoryId: category.id,
  });
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  const hashTag = `e2e-anly-${crypto.randomUUID().slice(0, 8)}`;
  try {
    // Synthetic multi-day traffic so every chart has data.
    const values: string[] = [];
    for (let day = 0; day < 7; day++) {
      for (let v = 0; v < day + 2; v++) {
        values.push(
          `('${post.id}', '/posts/${post.slug}', '${hashTag}-${crypto.randomUUID()}', now() - interval '${day} days')`,
        );
      }
    }
    await pool.query(
      `insert into page_views (post_id, path, visitor_hash, created_at) values ${values.join(",")}`,
    );

    await context.addCookies([admin.cookie]);
    await page.goto("/admin/analytics");

    await expect(
      page.getByRole("heading", { name: /analytics/i }),
    ).toBeVisible();
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("table").getByText(post.title).first(),
    ).toBeVisible();

    // Mobile-first (FR-9.4): phone width must not scroll horizontally.
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Nav entry last: on phone widths the links live in the hamburger sheet
    // (a dialog, not the nav landmark), which overlays the page once open.
    await openAdminNav(page);
    await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
  } finally {
    await pool.query(`delete from page_views where visitor_hash like $1`, [
      `${hashTag}-%`,
    ]);
    await pool.query(`delete from page_views where path = $1`, [
      `/posts/${post.slug}`,
    ]);
    await pool.end();
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
    await admin.cleanup();
  }
});

test("author gets no analytics nav, page, or endpoint access", async ({
  page,
  context,
  request,
}) => {
  const session = await createTestSession({ role: "author" });
  try {
    await context.addCookies([session.cookie]);
    await page.goto("/admin");
    // Open the hamburger sheet on phone widths (no-op on desktop) so the
    // absence check below inspects rendered nav links, not a hidden nav.
    await openAdminNav(page);
    await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);

    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: /analytics/i })).toHaveCount(
      0,
    );

    const apiRes = await request.get("/api/admin/analytics", {
      headers: { cookie: `${session.cookie.name}=${session.cookie.value}` },
    });
    expect(apiRes.status()).toBe(403);
  } finally {
    await session.cleanup();
  }
});

test("anonymous GET /api/admin/analytics is 401", async ({ request }) => {
  const res = await request.get("/api/admin/analytics");
  expect(res.status()).toBe(401);
});
