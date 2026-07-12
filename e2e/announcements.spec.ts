import crypto from "node:crypto";

import { expect, test } from "@playwright/test";

import { openAdminNav } from "./helpers/interaction";
import {
  createTestSession,
  deleteAnnouncementsByPrefix,
  type TestSession,
} from "./helpers/session";

// Admin-only announcement CRUD screen (ANN-2, FR-6.1/FR-6.3): an admin
// creates, edits, and deletes an announcement through the real
// /admin/announcements controls + server actions, and the page/nav-link are
// gated to Action.ManageAnnouncements (admin only — authors get nothing).
// Rows are created through the UI, not seeded, so cleanup sweeps them by
// body prefix (same rationale as category-management.spec.ts).

test.describe("admin announcement management", () => {
  let admin: TestSession;
  const prefix = `E2E Ann ${crypto.randomUUID().slice(0, 8)}`;

  test.beforeEach(async ({ context }) => {
    admin = await createTestSession({ role: "admin", userName: "E2E Admin" });
    await context.addCookies([admin.cookie]);
  });

  test.afterEach(async () => {
    await deleteAnnouncementsByPrefix(prefix);
    await admin.cleanup();
  });

  test("creates, edits, and deletes an announcement", async ({ page }) => {
    await page.goto("/admin/announcements");
    await expect(
      page.getByRole("heading", { name: "Announcements" }),
    ).toBeVisible();

    // Create: no retry — the submit button self-disables while the RHF
    // submit is in flight (same non-idempotent rationale as the categories
    // spec's Add click).
    const body = `${prefix} first take`;
    await page.getByLabel("Announcement", { exact: true }).fill(body);
    await page.getByRole("button", { name: "Post announcement" }).click();
    await expect(page.getByText(body, { exact: true })).toBeVisible({
      timeout: 15000,
    });

    // Edit: open the inline editor, change the body, save. The edit form's
    // textarea shares the "Announcement" label with the create form, so
    // scope to the row's <li>.
    const row = page.locator("li", { hasText: body });
    await row.getByRole("button", { name: "Edit" }).click();
    const edited = `${prefix} first take, revised`;
    await row.getByLabel("Announcement", { exact: true }).fill(edited);
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible({
      timeout: 15000,
    });

    // Delete: behind the AlertDialog confirmation.
    const editedRow = page.locator("li", { hasText: edited });
    await editedRow.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Delete this announcement?")).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(edited, { exact: true })).toHaveCount(0, {
      timeout: 15000,
    });
  });

  test("sees the Announcements nav link", async ({ page }) => {
    await page.goto("/admin");
    await openAdminNav(page);
    await expect(
      page.getByRole("link", { name: "Announcements" }),
    ).toBeVisible();
  });
});

// An author is staff (passes requireStaff) but lacks
// Action.ManageAnnouncements — requireCapability calls notFound(), same as
// /admin/categories, and the nav link is hidden accordingly.
test.describe("announcement management is admin-only", () => {
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

  test("gets a not-found page on /admin/announcements and no nav link", async ({
    page,
  }) => {
    await page.goto("/admin");
    await openAdminNav(page);
    await expect(page.getByRole("link", { name: "Announcements" })).toHaveCount(
      0,
    );

    await page.goto("/admin/announcements");
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Announcements" }),
    ).toHaveCount(0);
  });
});
