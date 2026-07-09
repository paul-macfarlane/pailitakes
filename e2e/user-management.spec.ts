import { expect, test } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  createTestSession,
  createTestUser,
  type TestSession,
  type TestUser,
} from "./helpers/session";

// Admin user-management screen (ADM-10): an admin changes another user's role
// and ban state through the real controls + server actions, and can't act on
// their own row (the self-lock that backs the "never leave zero admins"
// invariant). Both actors are freshly seeded, so they sort to the first page.

test.describe("admin user management", () => {
  let admin: TestSession;
  let subject: TestUser;

  test.beforeEach(async ({ context }) => {
    admin = await createTestSession({ role: "admin", userName: "E2E Admin" });
    subject = await createTestUser({ role: "reader", name: "E2E Subject" });
    await context.addCookies([admin.cookie]);
  });

  test.afterEach(async () => {
    await subject.cleanup();
    await admin.cleanup();
  });

  test("changes another user's role", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    const row = page.locator("li", { hasText: `${subject.id}@e2e.test` });
    const badge = row.locator("span"); // RoleBadge is the row's only <span>
    const roleSelect = page.locator(`#role-${subject.id}`);
    await expect(badge).toHaveText("Reader");

    // Retry covers a pre-hydration change event; the badge is server-rendered,
    // so it only flips once the action + refresh actually ran (not from the
    // client-side selectOption alone).
    await expect(async () => {
      await roleSelect.selectOption("author");
      await expect(badge).toHaveText("Author");
    }).toPass({ timeout: 15000 });
  });

  test("bans and unbans a user", async ({ page }) => {
    await page.goto("/admin/users");
    const row = page.locator("li", { hasText: `${subject.id}@e2e.test` });
    const badge = row.locator("span");

    await clickUntil(row.getByRole("button", { name: "Ban" }), () =>
      expect(badge).toContainText("Banned"),
    );
    await clickUntil(row.getByRole("button", { name: "Unban" }), () =>
      expect(badge).not.toContainText("Banned"),
    );
  });

  test("disables controls on the admin's own row", async ({ page }) => {
    await page.goto("/admin/users");
    const selfRow = page.locator("li", { hasText: `${admin.userId}@e2e.test` });

    await expect(selfRow).toContainText("(you)");
    // Self-demotion/self-ban are blocked in the UI (and server-side) — this is
    // what prevents an admin from removing the last admin via their own row.
    await expect(selfRow.locator("select")).toBeDisabled();
    await expect(selfRow.getByRole("button", { name: "Ban" })).toBeDisabled();
  });
});
