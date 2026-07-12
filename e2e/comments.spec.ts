import { expect, test } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  createTestCategory,
  createTestComment,
  createTestPost,
  createTestSession,
  type TestCategory,
  type TestPost,
  type TestSession,
} from "./helpers/session";

// Public comment-thread UI (CMT-3 tree, CMT-7 own edit/delete, CMT-8 admin
// delete-any button). Comment CREATION always calls the moderation LLM
// (src/lib/comments/service/create.ts) — deterministic e2e coverage here
// seeds comments directly via pg (mixed nesting, incl. a deleted
// placeholder that only renders because it has a visible reply — design
// D5) and only drives UI flows that don't create a new comment: composer
// visibility per auth state, and the owner delete flow (deleteComment has
// no moderation call — src/lib/comments/service/manage.ts).

test.describe("comment thread", () => {
  let author: TestSession;
  let category: TestCategory;
  let post: TestPost;

  test.beforeEach(async () => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Comment Author",
    });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
    });

    const root = await createTestComment({
      postId: post.id,
      authorId: author.userId,
      body: "Root comment for e2e coverage.",
    });
    await createTestComment({
      postId: post.id,
      authorId: author.userId,
      parentId: root.id,
      body: "A reply to the root comment.",
    });
    const deleted = await createTestComment({
      postId: post.id,
      authorId: author.userId,
      status: "deleted",
    });
    // The deleted placeholder only renders when it has a visible descendant
    // (buildCommentTree's pruning rule, design D5) — give it one.
    await createTestComment({
      postId: post.id,
      authorId: author.userId,
      parentId: deleted.id,
      body: "Reply to a deleted comment.",
    });
  });

  test.afterEach(async () => {
    // Comments cascade off the post (schema.ts), so post.cleanup() alone
    // removes everything seeded in beforeEach.
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("signed-out visitor reads the thread and sees a sign-in prompt, no composer", async ({
    page,
  }) => {
    await page.goto(`/posts/${post.slug}`);

    await expect(
      page.getByText("Root comment for e2e coverage."),
    ).toBeVisible();
    await expect(page.getByText("A reply to the root comment.")).toBeVisible();
    await expect(page.getByText("[deleted]")).toBeVisible();
    await expect(page.getByText("Reply to a deleted comment.")).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Sign in" }).last(),
    ).toBeVisible();
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
  });

  test("signed-in reader sees the composer", async ({ page, context }) => {
    const reader = await createTestSession({ userName: "E2E Comment Reader" });
    await context.addCookies([reader.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      await expect(page.getByLabel("Add a comment")).toBeVisible();
    } finally {
      await reader.cleanup();
    }
  });

  test("banned reader sees the banned notice and still sees the thread", async ({
    page,
    context,
  }) => {
    const banned = await createTestSession({
      userName: "E2E Banned Reader",
      banned: true,
    });
    await context.addCookies([banned.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      await expect(
        page.getByText("You’re banned from commenting."),
      ).toBeVisible();
      await expect(page.getByLabel("Add a comment")).toHaveCount(0);
      // The thread itself stays fully readable for a banned user.
      await expect(
        page.getByText("Root comment for e2e coverage."),
      ).toBeVisible();
    } finally {
      await banned.cleanup();
    }
  });

  test("owner can delete their own comment (no moderation involved)", async ({
    page,
    context,
  }) => {
    await context.addCookies([author.cookie]);
    await createTestComment({
      postId: post.id,
      authorId: author.userId,
      body: "My own comment to delete.",
    });

    await page.goto(`/posts/${post.slug}`);
    // Scoped to this specific comment's own <li> — the author also owns the
    // other seeded comments, which each carry their own "Delete" control.
    const item = page.locator("li", { hasText: "My own comment to delete." });
    await expect(item).toBeVisible();

    await clickUntil(item.getByRole("button", { name: "Delete" }), () =>
      expect(
        page.getByRole("alertdialog", { name: "Delete this comment?" }),
      ).toBeVisible(),
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect(page.getByText("My own comment to delete.")).toHaveCount(0);
  });
});
