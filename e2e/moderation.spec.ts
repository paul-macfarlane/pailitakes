import crypto from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";
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

config({ quiet: true });

// Admin moderation log (CMT-9, design §5.2 "Moderation log (admin)"): an
// admin browses held/rejected comments and resolves them through the real
// approve/restore controls + server actions; a staff-but-non-admin user is
// bounced the same way /admin/users bounces one (admin-gate.spec.ts). No LLM
// call in this spec — the held/rejected comments are seeded directly with a
// fixed mod_verdict, exercising only the log screen + CAS-guarded actions.

async function seedComment(options: {
  postId: string;
  authorId: string;
  status: "held" | "rejected";
  body: string;
}): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set (see .env.example)");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const modVerdict =
    options.status === "held"
      ? { error: "gateway timeout", model: "test-model", latencyMs: 5000 }
      : {
          verdict: "flag",
          reason: "profanity",
          model: "test-model",
          latencyMs: 120,
        };
  const { rows } = await pool.query<{ id: string }>(
    `insert into comments (post_id, author_id, body, status, mod_verdict)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      options.postId,
      options.authorId,
      options.body,
      options.status,
      JSON.stringify(modVerdict),
    ],
  );
  await pool.end();
  return rows[0]!.id;
}

test.describe("admin moderation log", () => {
  let admin: TestSession;
  let category: TestCategory;
  let post: TestPost;
  const heldBody = `E2E held comment ${crypto.randomUUID().slice(0, 8)}`;
  const rejectedBody = `E2E rejected comment ${crypto.randomUUID().slice(0, 8)}`;

  test.beforeEach(async ({ context }) => {
    admin = await createTestSession({ role: "admin", userName: "E2E Admin" });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: admin.userId,
      categoryId: category.id,
      title: `E2E Moderation Post ${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedComment({
      postId: post.id,
      authorId: admin.userId,
      status: "held",
      body: heldBody,
    });
    await seedComment({
      postId: post.id,
      authorId: admin.userId,
      status: "rejected",
      body: rejectedBody,
    });
    await context.addCookies([admin.cookie]);
  });

  test.afterEach(async () => {
    // post.cleanup() deletes the post; comments.post_id cascades (schema.ts).
    await post.cleanup();
    await category.cleanup();
    await admin.cleanup();
  });

  test("shows held and rejected comments under their filters, approves, and restores", async ({
    page,
  }) => {
    await page.goto("/admin/moderation");
    await expect(
      page.getByRole("heading", { name: "Moderation log" }),
    ).toBeVisible();

    // Default filter is "held" — the held comment is visible, the rejected
    // one is not.
    await expect(page.getByText(heldBody)).toBeVisible();
    await expect(page.getByText(rejectedBody)).toHaveCount(0);

    const heldRow = page.locator("li", { hasText: heldBody });
    await expect(
      heldRow.getByRole("button", { name: "Approve" }),
    ).toBeVisible();

    // Approve moves it to `visible`; the row leaves the held list.
    await clickUntil(heldRow.getByRole("button", { name: "Approve" }), () =>
      expect(page.getByText(heldBody)).toHaveCount(0),
    );

    // Switch to the rejected filter via the native <select> + Apply.
    await page.locator('form select[name="status"]').selectOption("rejected");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL("**/admin/moderation?status=rejected");

    await expect(page.getByText(rejectedBody)).toBeVisible();
    const rejectedRow = page.locator("li", { hasText: rejectedBody });
    await expect(
      rejectedRow.getByRole("button", { name: "Restore" }),
    ).toBeVisible();

    await clickUntil(rejectedRow.getByRole("button", { name: "Restore" }), () =>
      expect(page.getByText(rejectedBody)).toHaveCount(0),
    );
  });

  test("bounces a non-admin author from /admin/moderation and hides the nav link", async ({
    browser,
  }) => {
    const author = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    const authorContext = await browser.newContext();
    await authorContext.addCookies([author.cookie]);
    const authorPage = await authorContext.newPage();

    await authorPage.goto("/admin");
    await expect(
      authorPage.getByRole("link", { name: "Moderation" }),
    ).toHaveCount(0);

    // requireCapability(ModerateComments) calls notFound() for a staff-but-
    // non-admin user, same as requireAdmin does for /admin/users
    // (admin-gate.spec.ts).
    await authorPage.goto("/admin/moderation");
    await expect(authorPage.getByText(/could not be found/i)).toBeVisible();
    await expect(
      authorPage.getByRole("heading", { name: "Moderation log" }),
    ).toHaveCount(0);

    await authorContext.close();
    await author.cleanup();
  });
});
