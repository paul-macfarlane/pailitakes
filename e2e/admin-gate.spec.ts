import { expect, test } from "@playwright/test";

import { createTestSession, type TestSession } from "./helpers/session";

// The security boundary is the server action + requireStaff/requireAdmin gate
// (engineering rules: middleware is UX convenience only). These specs assert
// the page-level gates: readers are bounced home, staff see the dashboard, and
// /admin/users is admin-only (a 404 for authors).

test.describe("admin route gating", () => {
  test("logged-out user is redirected to sign-in", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("**/sign-in**");
    await expect(page.getByText("No email/password")).toBeVisible();
  });

  test.describe("reader", () => {
    let session: TestSession;

    test.beforeEach(async ({ context }) => {
      session = await createTestSession({ role: "reader" });
      await context.addCookies([session.cookie]);
    });

    test.afterEach(async () => {
      await session.cleanup();
    });

    test("is redirected away from /admin", async ({ page }) => {
      await page.goto("/admin");
      // requireStaff sends a signed-in non-staff user home.
      await page.waitForURL((url) => new URL(url).pathname === "/");
      await expect(
        page.getByRole("heading", { name: "Paulitakes" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Posts" })).toHaveCount(0);
    });
  });

  test.describe("author", () => {
    let session: TestSession;

    test.beforeEach(async ({ context }) => {
      session = await createTestSession({
        role: "author",
        userName: "E2E Author",
      });
      await context.addCookies([session.cookie]);
    });

    test.afterEach(async () => {
      await session.cleanup();
    });

    test("sees the posts dashboard", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
      // "New post" is a Base UI Button rendered as a Link — its ARIA role
      // shifts from link (SSR) to button (hydrated), so match the anchor href.
      await expect(page.locator('a[href="/admin/posts/new"]')).toBeVisible();
    });

    test("does not see the Users link (admin-only)", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    });

    test("the editor has a back link to the dashboard", async ({ page }) => {
      // Feedback point 3: no way back to admin after opening the editor.
      await page.goto("/admin/posts/new");
      await page.getByRole("link", { name: "← Posts" }).click();
      await page.waitForURL((url) => new URL(url).pathname === "/admin");
      await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
    });

    test("gets a not-found page on /admin/users", async ({ page }) => {
      // requireAdmin calls notFound() for a staff-but-non-admin user. Under
      // streaming the document status can be 200 with the not-found UI in the
      // stream, so assert the rendered boundary, not the HTTP status.
      await page.goto("/admin/users");
      await expect(page.getByText(/could not be found/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
    });
  });

  test.describe("admin", () => {
    let session: TestSession;

    test.beforeEach(async ({ context }) => {
      session = await createTestSession({
        role: "admin",
        userName: "E2E Admin",
      });
      await context.addCookies([session.cookie]);
    });

    test.afterEach(async () => {
      await session.cleanup();
    });

    test("sees the Users link and the users screen", async ({ page }) => {
      await page.goto("/admin");
      await page.getByRole("link", { name: "Users" }).click();
      await page.waitForURL("**/admin/users");
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    });
  });
});
