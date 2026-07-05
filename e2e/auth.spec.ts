import { expect, test } from "@playwright/test";

test("header shows sign-in entry when logged out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("sign-in page renders both provider buttons", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("No email/password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Discord" }),
  ).toBeVisible();
});

test("account page redirects to sign-in when logged out", async ({ page }) => {
  await page.goto("/account");
  await page.waitForURL("**/sign-in");
  await expect(page.getByText("No email/password")).toBeVisible();
});
