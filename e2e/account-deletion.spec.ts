import { expect, test } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  createTestCategory,
  createTestComment,
  createTestPost,
  createTestSession,
  createTestUser,
  type TestCategory,
  type TestPost,
  type TestSession,
  type TestUser,
} from "./helpers/session";

// Self-service account deletion (ACCT-1 / FR-10.4) through the /account
// AlertDialog. The refusal matrix and anonymization column-by-column
// semantics are proven exhaustively in src/lib/users/service.test.ts
// (ADR-0003: lib tests prove the rule, e2e proves the wiring once) — these
// specs cover the two wirings a unit test can't: the browser flow ending
// signed-out, and a beforeDelete refusal surfacing inside the dialog.

// Both specs rely on the minted session being fresh (created just now):
// Better Auth's /delete-user freshness check (24h) passes, so no password
// or re-auth is involved — same as a user who just signed in via OAuth.

test.describe("account deletion (reader)", () => {
  let reader: TestSession;
  let bystander: TestUser;
  let category: TestCategory;
  let post: TestPost;

  test.beforeEach(async ({ context }) => {
    reader = await createTestSession({ userName: "E2E SoonDeleted" });
    bystander = await createTestUser({ name: "E2E Bystander" });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: bystander.id,
      categoryId: category.id,
      status: "published",
    });
    await context.addCookies([reader.cookie]);
  });

  test.afterEach(async () => {
    // The reader row is deleted by the test itself; cleanup() is a no-op
    // safety net for a failed run. The reader's anonymized comment cascades
    // away with the post.
    await post.cleanup();
    await category.cleanup();
    await bystander.cleanup();
    await reader.cleanup();
  });

  test("deletes the account through the dialog; thread survives as a placeholder", async ({
    page,
  }) => {
    const parent = await createTestComment({
      postId: post.id,
      authorId: reader.userId,
      body: "Comment from a soon-deleted account.",
    });
    await createTestComment({
      postId: post.id,
      authorId: bystander.id,
      parentId: parent.id,
      body: "Reply that must survive.",
    });

    await page.goto("/account");
    const dialog = page.getByRole("alertdialog", {
      name: "Delete your account?",
    });
    await clickUntil(page.getByRole("button", { name: "Delete account" }), () =>
      expect(dialog).toBeVisible(),
    );

    // Cancel first: the dialog closes and the account is untouched.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Reopen and confirm. The confirm button shares its label with the
    // trigger, so it's scoped to the dialog; the click is single-shot (a
    // retry would re-delete a gone account), safe because the trigger
    // click above already proved hydration.
    await clickUntil(page.getByRole("button", { name: "Delete account" }), () =>
      expect(dialog).toBeVisible(),
    );
    await dialog.getByRole("button", { name: "Delete account" }).click();

    // Deletion ends signed out on the home page.
    await page.waitForURL((url) => new URL(url).pathname === "/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    // The session cookie is dead: /account bounces to sign-in.
    await page.goto("/account");
    await page.waitForURL((url) => new URL(url).pathname === "/sign-in");

    // The thread survives: anonymized placeholder + the bystander's reply,
    // original body gone (same placeholder rendering comments.spec.ts pins
    // for ordinary soft-deletes).
    await page.goto(`/posts/${post.slug}`);
    await expect(page.getByText("Reply that must survive.")).toBeVisible();
    await expect(page.getByText("[deleted]")).toBeVisible();
    await expect(
      page.getByText("Comment from a soon-deleted account."),
    ).toHaveCount(0);
  });
});

test.describe("account deletion refusal (author with posts)", () => {
  let author: TestSession;
  let category: TestCategory;
  let post: TestPost;

  test.beforeEach(async ({ context }) => {
    author = await createTestSession({
      role: "author",
      userName: "E2E RefusedAuthor",
    });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
      status: "draft",
    });
    await context.addCookies([author.cookie]);
  });

  test.afterEach(async () => {
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("shows the beforeDelete refusal in the dialog and stays signed in", async ({
    page,
  }) => {
    await page.goto("/account");
    const dialog = page.getByRole("alertdialog", {
      name: "Delete your account?",
    });
    await clickUntil(page.getByRole("button", { name: "Delete account" }), () =>
      expect(dialog).toBeVisible(),
    );
    await dialog.getByRole("button", { name: "Delete account" }).click();

    // The hook's message surfaces verbatim in the page's alert region.
    await expect(page.getByRole("alert")).toHaveText(
      "Your account has authored posts. Contact the site owner to transfer or delete them first.",
    );

    // Still signed in with an intact account: /account keeps rendering the
    // form instead of bouncing to sign-in.
    await page.goto("/account");
    await expect(page.getByLabel("Display name")).toBeVisible();
  });
});
