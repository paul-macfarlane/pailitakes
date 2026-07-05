import { expect, test } from "@playwright/test";

test("theme toggle switches between light, dark, and system", async ({
  page,
}) => {
  await page.goto("/");
  const html = page.locator("html");

  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);

  // Selection persists across reloads (next-themes localStorage).
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);
});
