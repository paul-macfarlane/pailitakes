import crypto from "node:crypto";

import { expect, test } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";

// FR-7.14: owner shares a draft through the Sharing page; the collaborator
// discovers it under Shared with me and gets exactly the granted access.
test("owner shares a draft as Reviewer, then upgrades to Editor", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author" });
  // Unique name: the Select option is matched by name and parallel specs
  // seed other authors.
  const collaborator = await createTestSession({
    role: "author",
    userName: `E2E Collaborator ${crypto.randomUUID().slice(0, 8)}`,
  });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "draft",
  });
  const options = page.locator('[data-slot="select-content"]');
  try {
    await context.addCookies([owner.cookie]);
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.locator("#title")).toHaveValue(post.title);
    // Navigation flushes the editor first; retry covers a pre-hydration click.
    await expect(async () => {
      await page.getByRole("button", { name: "Sharing", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Sharing" }),
      ).toBeVisible();
    }).toPass({ timeout: 15000 });

    const members = page.locator("section", {
      has: page.getByRole("heading", { name: "People with access" }),
    });
    await expect(async () => {
      await page.getByRole("combobox", { name: "Author" }).click();
      await options
        .getByRole("option", { name: collaborator.userName })
        .click();
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await expect(members).toContainText(collaborator.userName);
    }).toPass({ timeout: 15000 });

    // Reviewer: discovers the post, reads the preview, cannot edit.
    await context.clearCookies();
    await context.addCookies([collaborator.cookie]);
    await page.goto("/admin");
    const shared = page.locator("section", {
      has: page.getByRole("heading", { name: "Shared with me" }),
    });
    await expect(shared).toContainText("Reviewer");
    await shared.getByRole("link", { name: post.title }).click();
    await expect(page).toHaveURL(`/admin/preview/${post.id}`);
    await expect(page.getByRole("link", { name: "Edit post" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Reviews" })).toBeVisible();
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page).toHaveURL(`/admin/preview/${post.id}`);
    await page.goto(`/admin/posts/${post.id}/sharing`);
    await expect(page.getByRole("heading", { name: "Sharing" })).toHaveCount(0);

    // Owner upgrades to Editor. The select is controlled by server data, so
    // it only shows Editor once the action and refresh have landed.
    await context.clearCookies();
    await context.addCookies([owner.cookie]);
    await page.goto(`/admin/posts/${post.id}/sharing`);
    const access = page.getByRole("combobox", {
      name: `Access for ${collaborator.userName}`,
    });
    await expect(async () => {
      if (!(await access.textContent())?.includes("Editor")) {
        await access.click();
        await options.getByRole("option", { name: "Editor" }).click();
      }
      await expect(access).toContainText("Editor", { timeout: 5000 });
    }).toPass({ timeout: 15000 });

    // Editor: edits the draft but gets no owner-only controls.
    await context.clearCookies();
    await context.addCookies([collaborator.cookie]);
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.locator("#title")).toHaveValue(post.title);
    await expect(page.getByText("Shared with you as an Editor")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sharing", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Publish now" })).toHaveCount(
      0,
    );
  } finally {
    await post.cleanup();
    await collaborator.cleanup();
    await owner.cleanup();
    await category.cleanup();
  }
});
