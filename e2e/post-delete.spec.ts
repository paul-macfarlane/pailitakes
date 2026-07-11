import { expect, test } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
  type TestCategory,
  type TestPost,
  type TestSession,
} from "./helpers/session";

// Admin-only hard delete (ADM-4) through the edit page's AlertDialog. Posts
// are seeded directly (createTestPost) rather than driven through the editor
// — the delete flow itself is what's under test, not authoring.

test.describe("post delete (admin)", () => {
  let admin: TestSession;
  let category: TestCategory;
  let post: TestPost;

  test.beforeEach(async ({ context }) => {
    category = await createTestCategory();
    admin = await createTestSession({ role: "admin", userName: "E2E Admin" });
    await context.addCookies([admin.cookie]);
    // Published (not just draft) so the public-side disappearance can be
    // asserted too, not only the admin dashboard.
    post = await createTestPost({
      authorId: admin.userId,
      categoryId: category.id,
      status: "published",
    });
  });

  test.afterEach(async () => {
    // The post is deleted by the test itself; this is a no-op safety net for
    // a failed run that didn't reach the delete step.
    await post.cleanup();
    await category.cleanup();
    await admin.cleanup();
  });

  test("deletes a post through the confirmation dialog and it disappears everywhere", async ({
    page,
  }) => {
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.locator("#title")).toHaveValue(post.title);

    // Opening the dialog: retry covers a pre-hydration click on the trigger.
    // Curly quotes match PostDeleteControls' rendered title exactly.
    await clickUntil(page.getByRole("button", { name: "Delete post" }), () =>
      expect(
        page.getByRole("alertdialog", {
          name: `Delete “${post.title}”?`,
        }),
      ).toBeVisible(),
    );

    // The confirm click is not idempotent (a second click would hit a
    // now-nonexistent post), so no clickUntil retry here — the dialog is
    // already known-hydrated from the trigger click above.
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/admin");

    // Gone from the admin dashboard list.
    await expect(page.getByRole("link", { name: post.title })).toHaveCount(0);

    // Gone from the public site too (notFound(), not just an empty list).
    await page.goto(`/posts/${post.slug}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: post.title })).toHaveCount(
      0,
    );
  });
});

test.describe("post delete visibility (author)", () => {
  let author: TestSession;
  let category: TestCategory;
  let post: TestPost;

  test.beforeEach(async ({ context }) => {
    category = await createTestCategory();
    author = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    await context.addCookies([author.cookie]);
    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
      status: "draft",
    });
  });

  test.afterEach(async () => {
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("an author sees no delete control on their own post's edit page", async ({
    page,
  }) => {
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.locator("#title")).toHaveValue(post.title);

    await expect(page.getByRole("button", { name: "Delete post" })).toHaveCount(
      0,
    );
  });
});
