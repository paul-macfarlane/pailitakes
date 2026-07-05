import { expect, test, type Page } from "@playwright/test";

import { createTestSession, type TestSession } from "./helpers/session";

test.describe("signed-in user", () => {
  let session: TestSession;

  test.beforeEach(async ({ context }) => {
    session = await createTestSession();
    await context.addCookies([session.cookie]);
  });

  test.afterEach(async () => {
    await session.cleanup();
  });

  test("can open the account menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    // Regression: Base UI GroupLabel outside a Group crashed the menu here.
    await expect(page.getByText(session.userName)).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible();
  });

  test("can sign out from the menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  // The account-menu avatar only renders client-side (useSession), so its
  // presence guarantees hydration — clicking Save before hydration would
  // fire a native form submit instead of the react-hook-form handler.
  async function gotoAccountHydrated(page: Page) {
    await page.goto("/account");
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();
  }

  test("can update display name on the account page", async ({ page }) => {
    await gotoAccountHydrated(page);
    await page.getByLabel("Display name").fill("Renamed Tester");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
  });

  test("rejects a whitespace-only display name", async ({ page }) => {
    await gotoAccountHydrated(page);
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Display name must be/)).toBeVisible();
  });
});
