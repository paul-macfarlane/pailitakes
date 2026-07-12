import crypto from "node:crypto";

import { expect, test } from "@playwright/test";

import { clickUntil, openAdminNav } from "./helpers/interaction";
import {
  createTestSession,
  deleteCategoriesByPrefix,
  type TestSession,
} from "./helpers/session";

// Admin-only category CRUD screen (SRCH-1, FR-2.1): an admin creates,
// renames, and (de)activates a category through the real /admin/categories
// controls + server actions, and the page/nav-link are gated to
// Action.ManageCategories (admin only — authors get nothing per FR-2.1).
// Rows are created through the UI, not seeded, so cleanup sweeps them up by
// name prefix rather than a TestCategory.cleanup() call.

test.describe("admin category management", () => {
  let admin: TestSession;
  const prefix = `E2E Cat ${crypto.randomUUID().slice(0, 8)}`;

  test.beforeEach(async ({ context }) => {
    admin = await createTestSession({ role: "admin", userName: "E2E Admin" });
    await context.addCookies([admin.cookie]);
  });

  test.afterEach(async () => {
    // Runs even if an assertion above threw — the only way UI-created rows
    // get cleaned up (see deleteCategoriesByPrefix).
    await deleteCategoriesByPrefix(prefix);
    await admin.cleanup();
  });

  test("creates, renames, and (de)activates a category", async ({ page }) => {
    await page.goto("/admin/categories");
    await expect(
      page.getByRole("heading", { name: "Categories" }),
    ).toBeVisible();

    // Create: the row appears with a derived slug (lowercase, hyphenated).
    // No clickUntil retry here — the Add button self-disables once the name
    // input clears on success (unlike the toggle controls below, which stay
    // enabled), so a blind retry could click a disabled button and hang
    // rather than skip (same non-idempotent rationale as post-delete.spec.ts's
    // "Delete permanently" click).
    await page.getByLabel("New category").fill(prefix);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(prefix, { exact: true })).toBeVisible({
      timeout: 15000,
    });

    const row = page.locator("li", { hasText: prefix });
    const derivedSlug = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await expect(row.getByText(derivedSlug, { exact: true })).toBeVisible();

    // Rename: the row's name updates; the slug text stays the create-time
    // value (SRCH-1 locked invariant — slug never changes on rename).
    const renamedName = `${prefix} Renamed`;
    const nameInput = row.getByLabel("Name");
    await nameInput.fill(renamedName);
    await clickUntil(row.getByRole("button", { name: "Save" }), () =>
      expect(page.getByText(renamedName, { exact: true })).toBeVisible(),
    );
    const renamedRow = page.locator("li", { hasText: renamedName });
    await expect(
      renamedRow.getByText(derivedSlug, { exact: true }),
    ).toBeVisible();

    // Deactivate: the "Inactive" cue appears and the button flips to
    // "Activate".
    await clickUntil(
      renamedRow.getByRole("button", { name: "Deactivate" }),
      () => expect(renamedRow.getByText("Inactive")).toBeVisible(),
    );
    await expect(
      renamedRow.getByRole("button", { name: "Activate" }),
    ).toBeVisible();

    // Reactivate: the cue clears.
    await clickUntil(renamedRow.getByRole("button", { name: "Activate" }), () =>
      expect(renamedRow.getByText("Inactive")).toHaveCount(0),
    );
  });

  test("sees the Categories nav link", async ({ page }) => {
    await page.goto("/admin");
    await openAdminNav(page);
    await expect(page.getByRole("link", { name: "Categories" })).toBeVisible();
  });
});

// An author is staff (passes requireStaff) but lacks Action.ManageCategories
// — requireCapability calls notFound() the same way requireAdmin does for
// /admin/users (admin-gate.spec.ts), and the nav link is hidden accordingly.
test.describe("category management is admin-only", () => {
  let author: TestSession;

  test.beforeEach(async ({ context }) => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    await context.addCookies([author.cookie]);
  });

  test.afterEach(async () => {
    await author.cleanup();
  });

  test("gets a not-found page on /admin/categories and no nav link", async ({
    page,
  }) => {
    await page.goto("/admin");
    // At mobile the links live inside a closed (unmounted) sheet — open it
    // first so absence is meaningful, not just "sheet is closed".
    await openAdminNav(page);
    await expect(page.getByRole("link", { name: "Categories" })).toHaveCount(0);

    await page.goto("/admin/categories");
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Categories" })).toHaveCount(
      0,
    );
  });
});
