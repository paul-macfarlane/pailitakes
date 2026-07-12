import { config } from "dotenv";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";

import {
  createTestCategory,
  createTestComment,
  createTestPost,
  createTestSession,
  type TestCategory,
  type TestComment,
  type TestPost,
  type TestSession,
} from "./helpers/session";

config({ quiet: true });

// Public like buttons (LIKE-3, design §5.4): the toggle is a plain server
// action + useOptimistic, no moderation involved — deterministic e2e
// coverage seeds a pre-existing like directly via SQL (mirrors
// moderation.spec.ts's seedComment helper) rather than driving a second
// browser session, then drives the real tap/reload flow for both the post
// and a comment.

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set (see .env.example)");
  }
  return databaseUrl;
}

async function seedPostLike(postId: string, userId: string): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  await pool.query(
    `insert into post_likes (post_id, user_id) values ($1, $2)`,
    [postId, userId],
  );
  await pool.end();
}

async function seedCommentLike(
  commentId: string,
  userId: string,
): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  await pool.query(
    `insert into comment_likes (comment_id, user_id) values ($1, $2)`,
    [commentId, userId],
  );
  await pool.end();
}

test.describe("like buttons", () => {
  let author: TestSession;
  let category: TestCategory;
  let post: TestPost;
  let comment: TestComment;

  test.beforeEach(async () => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Like Author",
    });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
    });
    comment = await createTestComment({
      postId: post.id,
      authorId: author.userId,
      body: "A comment to like.",
    });
    // Baseline like from the author on both the post and the comment — gives
    // a signed-out visitor and a fresh reader something other than zero to
    // read/increment (post_likes/comment_likes cascade off posts/comments,
    // schema.ts, so post.cleanup() alone removes these too).
    await seedPostLike(post.id, author.userId);
    await seedCommentLike(comment.id, author.userId);
  });

  test.afterEach(async () => {
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("signed-out visitor sees like counts but a tap shows a sign-in message", async ({
    page,
  }) => {
    await page.goto(`/posts/${post.slug}`);

    const postLikeButton = page.getByRole("button", { name: "Like this post" });
    await expect(postLikeButton).toContainText("1");
    const commentLikeButton = page.getByRole("button", {
      name: "Like this comment",
    });
    await expect(commentLikeButton).toContainText("1");

    await postLikeButton.click();
    await expect(page.getByText("Sign in to like.")).toBeVisible();
    // No optimistic flip happened — still just the baseline count.
    await expect(postLikeButton).toContainText("1");
    await expect(postLikeButton).toHaveAttribute("aria-pressed", "false");
  });

  test("signed-in reader toggles the post like, and it persists across reload", async ({
    page,
    context,
  }) => {
    const reader = await createTestSession({ userName: "E2E Like Reader" });
    await context.addCookies([reader.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      const postLikeButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(postLikeButton).toContainText("1");
      await expect(postLikeButton).toHaveAttribute("aria-pressed", "false");

      await postLikeButton.click();
      await expect(postLikeButton).toHaveAttribute("aria-pressed", "true");
      await expect(postLikeButton).toContainText("2");

      await page.reload();
      const reloadedButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "true");
      await expect(reloadedButton).toContainText("2");

      await reloadedButton.click();
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "false");
      await expect(reloadedButton).toContainText("1");

      await page.reload();
      const untoggledButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(untoggledButton).toHaveAttribute("aria-pressed", "false");
      await expect(untoggledButton).toContainText("1");
    } finally {
      await reader.cleanup();
    }
  });

  test("signed-in reader likes a comment and it persists across reload", async ({
    page,
    context,
  }) => {
    const reader = await createTestSession({ userName: "E2E Like Reader" });
    await context.addCookies([reader.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      const commentLikeButton = page.getByRole("button", {
        name: "Like this comment",
      });
      await expect(commentLikeButton).toContainText("1");

      await commentLikeButton.click();
      await expect(commentLikeButton).toHaveAttribute("aria-pressed", "true");
      await expect(commentLikeButton).toContainText("2");

      await page.reload();
      const reloadedButton = page.getByRole("button", {
        name: "Like this comment",
      });
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "true");
      await expect(reloadedButton).toContainText("2");
    } finally {
      await reader.cleanup();
    }
  });
});
