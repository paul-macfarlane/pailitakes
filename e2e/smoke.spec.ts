import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Paulitakes" })).toBeVisible();
});

test("auth endpoint is wired", async ({ request }) => {
  const res = await request.get("/api/auth/ok");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
