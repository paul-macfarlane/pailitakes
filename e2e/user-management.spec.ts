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
    // The RoleBadge span carries no data-slot; the Select's SelectValue span
    // (data-slot="select-value") shares the same row and, once the role
    // changes, the same text — so exclude it rather than matching on text.
    const badge = row.locator("span:not([data-slot])");
    const roleCombobox = row.getByRole("combobox", { name: "Role" });
    await expect(badge).toHaveText("Reader");

    // Retry covers a pre-hydration click; the badge is server-rendered, so it
    // only flips once the action + refresh actually ran (not from the
    // client-side selection alone). Scope the option to the Select's popup
    // (data-slot="select-content") — the filter form's native <option>s also
    // expose role="option" with the same accessible names.
    const roleOptions = page.locator('[data-slot="select-content"]');
    await expect(async () => {
      await roleCombobox.click();
      await roleOptions.getByRole("option", { name: "Author" }).click();
      await expect(badge).toHaveText("Author");
    }).toPass({ timeout: 15000 });
  });

  test("bans and unbans a user", async ({ page }) => {
    await page.goto("/admin/users");
    const row = page.locator("li", { hasText: `${subject.id}@e2e.test` });
    const badge = row.locator("span:not([data-slot])");

    await clickUntil(row.getByRole("button", { name: "Ban" }), () =>
      expect(badge).toContainText("Banned"),
    );
    await clickUntil(row.getByRole("button", { name: "Unban" }), () =>
      expect(badge).not.toContainText("Banned"),
    );
  });

  test("filters the list with search", async ({ page }) => {
    await page.goto("/admin/users");
    const subjectRow = page.locator("li", {
      hasText: `${subject.id}@e2e.test`,
    });
    const selfRow = page.locator("li", { hasText: `${admin.userId}@e2e.test` });
    await expect(subjectRow).toBeVisible();

    // The subject's id lives in its email, not the admin's, so searching it
    // narrows the list to the subject alone. Also set a role filter so the
    // reset is exercised against a <select> as well as the search input.
    const roleSelect = page.locator('form select[name="role"]');
    await page.getByRole("searchbox").fill(subject.id);
    await roleSelect.selectOption("reader");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(subjectRow).toBeVisible();
    await expect(selfRow).toHaveCount(0);

    // Reset returns the form to its defaults (unfiltered list) — including the
    // control values, not just the URL. The Base UI Button rendered as a Link
    // shifts role (link→button) on hydration and shares the nav's /admin/users
    // href, so match by text within the form.
    await page.locator("form").getByText("Reset", { exact: true }).click();
    await page.waitForURL((url) => new URL(url).search === "");
    await expect(selfRow).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(roleSelect).toHaveValue("");
  });

  test("disables controls on the admin's own row", async ({ page }) => {
    await page.goto("/admin/users");
    const selfRow = page.locator("li", { hasText: `${admin.userId}@e2e.test` });

    await expect(selfRow).toContainText("(you)");
    // Self-demotion/self-ban are blocked in the UI (and server-side) — this is
    // what prevents an admin from removing the last admin via their own row.
    await expect(
      selfRow.getByRole("combobox", { name: "Role" }),
    ).toBeDisabled();
    await expect(selfRow.getByRole("button", { name: "Ban" })).toBeDisabled();
  });
});
