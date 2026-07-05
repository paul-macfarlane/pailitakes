import { expect, test } from "@playwright/test";

test("header shows sign-in entry when logged out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("sign-in page renders", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("No email/password")).toBeVisible();
  // Locally OAuth clients may not exist yet — either real provider buttons
  // or the not-configured notice must render, never a blank card.
  const buttons = page.getByRole("button", { name: /Continue with/ });
  const notice = page.getByText("isn't configured in this environment");
  await expect(buttons.first().or(notice)).toBeVisible();
});

test("account page redirects to sign-in when logged out", async ({ page }) => {
  await page.goto("/account");
  await page.waitForURL("**/sign-in");
  await expect(page.getByText("No email/password")).toBeVisible();
});
