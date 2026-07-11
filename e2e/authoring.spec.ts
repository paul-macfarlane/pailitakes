import crypto from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  createTestCategory,
  createTestSession,
  type TestCategory,
  type TestSession,
} from "./helpers/session";

// Exercises the author content lifecycle end-to-end through the real UI and
// server actions: create a draft in the editor, publish it (and confirm it goes
// public), schedule a future publish, and view the private preview. Auth is a
// seeded author session (no OAuth); a seeded category makes the editor render.

const THUMBNAIL = "https://example.com/e2e-thumb.png";

test.describe("authoring lifecycle", () => {
  let session: TestSession;
  let category: TestCategory;

  test.beforeEach(async ({ context }) => {
    category = await createTestCategory();
    session = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    await context.addCookies([session.cookie]);
  });

  test.afterEach(async () => {
    // Author cleanup drops the author's posts first, then the category — both
    // are order-independent (each clears referencing posts defensively).
    await session.cleanup();
    await category.cleanup();
  });

  // Creates a draft through the editor and returns its id + resolved slug.
  // The editor assigns the id on first save and swaps the URL to the edit
  // route (history.replaceState), so we read the id back from the URL.
  async function createDraft(
    page: Page,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    await page.goto("/admin/posts/new");
    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();

    // Pick THIS test's own category. The editor otherwise defaults to a shared
    // first category, so the post wouldn't be isolated to a category only this
    // test cleans up — and a concurrent test's category cleanup could delete
    // the post (404-ing its edit page). Retry covers pre-hydration clicks on
    // the Base UI Select.
    const categoryTrigger = page.locator("#category");
    await expect(async () => {
      await categoryTrigger.click({ timeout: 3000 });
      await page
        .getByRole("option", { name: category.name })
        .click({ timeout: 3000 });
      await expect(categoryTrigger).toContainText(category.name);
    }).toPass({ timeout: 15000 });

    // Target editor fields by id — getByLabel("Body") is ambiguous (the
    // Write/Preview toggle group is aria-label="Body view").
    await page.locator("#title").fill(title);
    await page.locator("#thumbnailUrl").fill(THUMBNAIL);
    await page.locator("#bodyMd").fill("First take. **Bold** and clear.");

    // A single filled form + "Save now" must persist the draft. clickUntil only
    // re-clicks (never re-edits), so if the editor regressed to skipping the
    // first save until a post-hydration field change, this would time out.
    const status = page.getByRole("status");
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(status).toContainText("Saved"),
    );

    await page.waitForURL(/\/admin\/posts\/[^/]+\/edit/);
    const id = page.url().match(/\/admin\/posts\/([^/]+)\/edit/)?.[1];
    expect(id, "post id in edit URL").toBeTruthy();

    // Load the server-rendered edit page so the status/schedule islands mount.
    await page.goto(`/admin/posts/${id}/edit`);
    // react-hook-form populates the uncontrolled slug field on the client after
    // hydration, so wait for its server-derived value before reading it.
    const slugInput = page.locator("#slug");
    await expect(slugInput).not.toHaveValue("");
    const slug = await slugInput.inputValue();
    return { id: id!, slug };
  }

  test("publishes a draft and it renders on the public site", async ({
    page,
  }) => {
    const title = `E2E Publish ${crypto.randomUUID().slice(0, 8)}`;
    // createDraft leaves the page on the edit view, status controls mounted.
    const { slug } = await createDraft(page, title);

    await clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
      expect(page.getByText("Published")).toBeVisible(),
    );

    const response = await page.goto(`/posts/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Reader can get back to the post list from a post (public back-link).
    await page.getByRole("link", { name: "← All posts" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/");
    await expect(
      page.getByRole("heading", { name: "Paulitakes" }),
    ).toBeVisible();
  });

  test("schedules a future publish (not yet public)", async ({ page }) => {
    const title = `E2E Schedule ${crypto.randomUUID().slice(0, 8)}`;
    const { slug } = await createDraft(page, title);

    await page.locator("#schedule-publish").fill("2030-06-01T12:00");
    await clickUntil(
      page.getByRole("button", { name: "Schedule", exact: true }),
      () => expect(page.getByText("Scheduled to publish")).toBeVisible(),
    );

    // Status badge reflects the scheduled state.
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

    // A future publish_at means it isn't publicly visible yet (visiblePostsWhere).
    // notFound() can stream a 200 document, so assert the boundary, not status.
    await page.goto(`/posts/${slug}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  });

  test("edits to a published post stay staged until published", async ({
    page,
  }) => {
    const title = `E2E Staged ${crypto.randomUUID().slice(0, 8)}`;
    const { id, slug } = await createDraft(page, title);

    // Publish the post first.
    await clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
      expect(page.getByText("Published")).toBeVisible(),
    );

    // Edit the (now published) post's title. This stages a draft rather than
    // writing live; the first staged save surfaces the "Unpublished changes"
    // banner (a sibling island revealed via router.refresh).
    const newTitle = `${title} EDITED`;
    await page.locator("#title").fill(newTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page.getByText("Unpublished changes")).toBeVisible(),
    );

    // The public post still shows the ORIGINAL title — staging never touches
    // the live content or its cache.
    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: newTitle })).toHaveCount(0);

    // Promote the staged changes from the editor.
    await page.goto(`/admin/posts/${id}/edit`);
    await clickUntil(
      page.getByRole("button", { name: "Publish changes" }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );

    // Now the public post reflects the edit.
    await expect(async () => {
      await page.goto(`/posts/${slug}`);
      await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
    }).toPass();
  });

  test("discards staged edits and restores the live values", async ({
    page,
  }) => {
    const title = `E2E Discard ${crypto.randomUUID().slice(0, 8)}`;
    const { id, slug } = await createDraft(page, title);

    // Publish the post first.
    await clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
      expect(page.getByText("Published")).toBeVisible(),
    );

    // Stage an edit (same setup as the "stays staged" spec above).
    const newTitle = `${title} EDITED`;
    await page.locator("#title").fill(newTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page.getByText("Unpublished changes")).toBeVisible(),
    );

    // Discard throws the staged draft away. Like "Publish changes", this does
    // a full reload (see PostPendingControls) — the editor re-initializes
    // from the server's now-unstaged post, so the title field must show the
    // ORIGINAL value again, not the discarded edit.
    await clickUntil(
      page.getByRole("button", { name: "Discard changes" }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );
    await expect(page.locator("#title")).toHaveValue(title);

    // The editor's own re-render already reflects the live post now — reload
    // the edit page fresh to also confirm the server-rendered controls agree
    // (no pending-changes banner, Publish/Archive available again).
    await page.goto(`/admin/posts/${id}/edit`);
    await expect(page.getByText("Unpublished changes")).toHaveCount(0);
    await expect(page.locator("#title")).toHaveValue(title);

    // The public post was never touched by the discarded edit either.
    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: newTitle })).toHaveCount(0);
  });

  test("shows a draft in the private preview", async ({ page }) => {
    const title = `E2E Preview ${crypto.randomUUID().slice(0, 8)}`;
    const { id } = await createDraft(page, title);

    // The editor's Preview link points at the preview route.
    await expect(page.getByRole("link", { name: "Preview" })).toHaveAttribute(
      "href",
      `/admin/preview/${id}`,
    );

    await page.goto(`/admin/preview/${id}`);
    await expect(page.getByText(/Preview ·/)).toBeVisible();
    await expect(page.getByText("not visible to the public")).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
