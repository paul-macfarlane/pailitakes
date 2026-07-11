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

// Public search + category/tag listing surfaces (SRCH-2..SRCH-5). A post is
// seeded directly (bypassing the editor — authoring is covered by
// authoring.spec.ts) with a distinctive body word and tag so full-text
// search, the search UI's debounced input + category filter, and the
// /categories/[slug] and /tags/[slug] pages can all be asserted against a
// result set of exactly one. /search is uncached (no-store); /categories and
// /tags carry a 60s "use cache" (design §3), so DB state is seeded in
// beforeEach BEFORE any request hits those routes, and every slug (category,
// tag, post) is minted fresh per test run — no prior run's cached page for
// the same slug can exist.

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
    // A second active category with no posts in it — the filter test needs
    // a selectable category that can never match the seeded post.
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
    await page.goto(`/search?q=${bodyWord}`);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
    await expect(page.locator("mark", { hasText: bodyWord })).toBeVisible();
  });

  test("typing into the search input debounces into a URL update and shows the result", async ({
    page,
  }) => {
    await page.goto("/search");
    await page.getByRole("searchbox").fill(bodyWord);
    await page.waitForURL(
      (url) => new URL(url).searchParams.get("q") === bodyWord,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });

  test("category filter: a non-matching category hides the result, the matching one keeps it", async ({
    page,
  }) => {
    await page.goto(`/search?q=${bodyWord}`);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    const categorySelect = page.locator('form select[name="category"]');
    await categorySelect.selectOption(otherCategory.slug);
    await page.waitForURL(
      (url) => new URL(url).searchParams.get("category") === otherCategory.slug,
    );
    await expect(page.getByText(/No results for/)).toBeVisible();

    await categorySelect.selectOption(category.slug);
    await page.waitForURL(
      (url) => new URL(url).searchParams.get("category") === category.slug,
    );
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });

  test("category page shows the post", async ({ page }) => {
    const response = await page.goto(`/categories/${category.slug}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: category.name }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  });

  test("unknown category slug 404s", async ({ page }) => {
    const response = await page.goto("/categories/zzz-nope");
    expect(response?.status()).toBe(404);
  });

  test("tag page shows the post, and its category link navigates to the category page", async ({
    page,
  }) => {
    const response = await page.goto(`/tags/${post.tagSlugs[0]}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

    // PostCard's category name links out to /categories/[slug] (SRCH-2).
    await page.getByRole("link", { name: category.name }).click();
    await page.waitForURL(`**/categories/${category.slug}`);
    await expect(
      page.getByRole("heading", { name: category.name }),
    ).toBeVisible();
  });
});
