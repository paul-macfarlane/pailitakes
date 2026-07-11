import crypto from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createTestCategory,
  createTestPost,
  createTestSession,
  type TestCategory,
  type TestPost,
  type TestSession,
} from "./helpers/session";

// Public browse/search surface (SRCH-2..SRCH-5): `/` folds search and
// category browsing together behind combinable `q`/`category` query params
// (owner-approved fold of /search + /categories/[slug] into home, epic 03
// SRCH). A post is seeded directly (bypassing the editor — authoring is
// covered by authoring.spec.ts) with a distinctive body word and tag so
// full-text search, the home search box's debounced input, category-pill
// filtering, and the /tags/[slug] page can all be asserted against a result
// set of exactly one.
//
// Home's Suspense section (search box, pills, results/feed) reads
// searchParams and is therefore dynamic/uncached per route (ADR-0008), so
// every test below that passes q/category sees fresh DB state. The one
// exception is the plain no-param feed: getHomeFeed itself still carries its
// own 60s "use cache" entry (design §3), which may predate a just-seeded
// post — no test here asserts freshly-seeded content against the default,
// param-less feed. /tags/[slug] keeps its own page-level 60s cache exactly
// as before, so seeding (in beforeEach, before any request hits the route)
// still matters there.

test.describe("search and listing", () => {
  let author: TestSession;
  let category: TestCategory;
  let otherCategory: TestCategory;
  let post: TestPost;
  let bodyWord: string;

  test.beforeEach(async () => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    category = await createTestCategory();
    // A second active category with no posts in it — the pill-filter test
    // needs a selectable category that can never match the seeded post.
    otherCategory = await createTestCategory();
    // Alpha-prefixed (not pure digits) so Postgres's English text search
    // config tokenizes it as a plain word, not a number.
    bodyWord = `zzzbodyword${crypto.randomUUID().slice(0, 8)}`;

    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
      title: `E2E Search Post ${crypto.randomUUID().slice(0, 8)}`,
      bodyMd: `This distinctive paragraph mentions ${bodyWord} explicitly for search coverage.`,
      tags: [`E2E Tag ${crypto.randomUUID().slice(0, 8)}`],
    });
  });

  test.afterEach(async () => {
    await post.cleanup();
    await otherCategory.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("direct search URL shows the post with a highlighted snippet", async ({
    page,
  }) => {
    await page.goto(`/?q=${bodyWord}`);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
    await expect(page.locator("mark", { hasText: bodyWord })).toBeVisible();
  });

  test("typing into the home search box debounces into a URL update and shows the result", async ({
    page,
  }) => {
    await page.goto("/");
    const searchInput = page.getByRole("searchbox", { name: "Search posts" });
    await searchInput.fill(bodyWord);
    await page.waitForURL(
      (url) => new URL(url).searchParams.get("q") === bodyWord,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });

  test("category pills combine with an active search query", async ({
    page,
  }) => {
    await page.goto(`/?q=${bodyWord}`);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    const pills = page.getByRole("navigation", { name: "Categories" });

    await pills.getByRole("link", { name: otherCategory.name }).click();
    await page.waitForURL(
      (url) =>
        new URL(url).searchParams.get("category") === otherCategory.slug &&
        new URL(url).searchParams.get("q") === bodyWord,
    );
    await expect(page.getByText(/No results for/)).toBeVisible();

    await pills.getByRole("link", { name: category.name }).click();
    await page.waitForURL(
      (url) =>
        new URL(url).searchParams.get("category") === category.slug &&
        new URL(url).searchParams.get("q") === bodyWord,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    await pills.getByRole("link", { name: "All", exact: true }).click();
    await page.waitForURL(
      (url) =>
        new URL(url).searchParams.get("category") === null &&
        new URL(url).searchParams.get("q") === bodyWord,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });

  test("category browse mode shows the post and marks its pill active", async ({
    page,
  }) => {
    const response = await page.goto(`/?category=${category.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    const pills = page.getByRole("navigation", { name: "Categories" });
    await expect(
      pills.getByRole("link", { name: category.name }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      pills.getByRole("link", { name: otherCategory.name }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("unknown category slug degrades to an empty state, not a 404", async ({
    page,
  }) => {
    const response = await page.goto("/?category=zzz-nope");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("No posts in this category yet."),
    ).toBeVisible();
  });

  test("tag page shows the post, and its category link navigates to the home category filter", async ({
    page,
  }) => {
    const response = await page.goto(`/tags/${post.tagSlugs[0]}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    // PostCard's category name now links to home's `?category=` filter
    // (SRCH-2 fold), not a dedicated /categories/[slug] route.
    await page.getByRole("link", { name: category.name }).click();
    await page.waitForURL(
      (url) => new URL(url).searchParams.get("category") === category.slug,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });
});

// Own describe/fixtures (rather than folding into the block above): needs 11
// posts in a dedicated category, isolated from the single-post fixture the
// other scenarios share. Also pins the fix for the load-more-island bug this
// epic replaced: LoadMorePosts kept its appended-posts React state across
// searchParams navigations, so switching `?category=` mid-scroll left the
// previous category's posts appended underneath the new category's first
// page. Stateless URL pagination (FeedPagination) makes that impossible —
// the URL is the only state, so a fresh navigation always starts clean.
test.describe("category feed pagination", () => {
  let author: TestSession;
  let category: TestCategory;
  let posts: TestPost[];

  test.beforeEach(async () => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Pagination Author",
    });
    category = await createTestCategory();

    posts = [];
    const runId = crypto.randomUUID().slice(0, 8);
    // Sequential (not Promise.all): each call's publishAt is `Date.now() -
    // 1s` at insert time, so awaiting in order gives strictly increasing
    // publishAt across the 11 rows — the feed's tiebreaker order (posts.ts)
    // falls back to a random-per-row uuid, which would make page boundaries
    // flaky if any two rows tied on publishAt.
    for (let i = 0; i < 11; i++) {
      posts.push(
        await createTestPost({
          authorId: author.userId,
          categoryId: category.id,
          title: `E2E Pagination Post ${runId} ${String(i).padStart(2, "0")}`,
        }),
      );
    }
  });

  test.afterEach(async () => {
    for (const seededPost of posts) {
      await seededPost.cleanup();
    }
    await category.cleanup();
    await author.cleanup();
  });

  test("category feed pages by 10 with URL-only pagination", async ({
    page,
  }) => {
    // Insertion order 0..10 means index 10 (last created) has the latest
    // publishAt, so it's first in feed order (page 1); index 0 (first
    // created) is oldest, so it's the sole overflow post on page 2.
    const newestPost = posts[10]!;
    const oldestPost = posts[0]!;

    const response = await page.goto(`/?category=${category.slug}`);
    expect(response?.status()).toBe(200);

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(10);
    await expect(
      page.getByRole("heading", { name: newestPost.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: oldestPost.title }),
    ).toHaveCount(0);

    // The Base UI pagination primitives render Previous/Next as
    // role="button" (Button underneath, nativeButton={false}) even though
    // they're real anchors under the hood — see src/components/ui/pagination.tsx.
    const nextLink = page.getByRole("button", { name: "Go to next page" });
    await expect(nextLink).toBeVisible();
    await nextLink.click();
    await page.waitForURL(
      (url) =>
        new URL(url).searchParams.get("page") === "2" &&
        new URL(url).searchParams.get("category") === category.slug,
    );

    await expect(cards).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: oldestPost.title }),
    ).toBeVisible();
    // Pins the leak fix: page 1's post must not still be appended on page 2.
    await expect(
      page.getByRole("heading", { name: newestPost.title }),
    ).toHaveCount(0);

    const prevLink = page.getByRole("button", { name: "Go to previous page" });
    await expect(prevLink).toBeVisible();
    await prevLink.click();
    await page.waitForURL(
      (url) =>
        new URL(url).searchParams.get("page") === null &&
        new URL(url).searchParams.get("category") === category.slug,
    );
    await expect(cards).toHaveCount(10);
  });
});
