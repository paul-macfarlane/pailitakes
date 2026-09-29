import crypto from "node:crypto";

import { expect, test, type Locator } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
  shareTestPost,
} from "./helpers/session";

// Selecting in a read-only textarea: set the range, then fire the events
// React's onSelect listens for.
async function selectText(source: Locator, text: string) {
  await source.evaluate((el, needle) => {
    const area = el as HTMLTextAreaElement;
    const start = area.value.indexOf(needle);
    area.focus();
    area.setSelectionRange(start, start + needle.length);
    area.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    area.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }, text);
}

// FR-7.15–7.16: request → review in progress → submit → owner applies one
// suggestion and discusses it; statuses follow on both dashboards.
test("owner requests a human review, reviewer submits, owner applies and discusses", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author" });
  const reviewer = await createTestSession({
    role: "author",
    userName: `E2E Reviewer ${crypto.randomUUID().slice(0, 8)}`,
  });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "draft",
    bodyMd: "The Bears won big.\n\nTeh defense was great.\n",
  });
  await shareTestPost(post.id, reviewer.userId);
  const reviewerRow = page.locator("li", { hasText: reviewer.userName });
  try {
    // Owner requests the review.
    await context.addCookies([owner.cookie]);
    await page.goto(`/admin/posts/${post.id}/sharing`);
    await expect(async () => {
      await page
        .getByRole("button", {
          name: `Request review from ${reviewer.userName}`,
        })
        .click();
      await expect(reviewerRow).toContainText("Review requested", {
        timeout: 5000,
      });
    }).toPass({ timeout: 15000 });

    // Reviewer sees the request, drafts a correction and general feedback.
    await context.clearCookies();
    await context.addCookies([reviewer.cookie]);
    await page.goto("/admin");
    await expect(
      page.locator("section", {
        has: page.getByRole("heading", { name: "Shared with me" }),
      }),
    ).toContainText("Review requested");
    await page.goto(`/admin/posts/${post.id}/review`);
    await expect(async () => {
      await page.getByRole("button", { name: "Start review" }).click();
      await expect(
        page.getByRole("heading", { name: "Your review" }),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 15000 });

    const source = page.getByLabel("Select text, then suggest");
    await selectText(source, "Teh");
    await page.getByRole("button", { name: "Suggest edit" }).click();
    await page.getByLabel("Replace with").fill("The");
    await page.getByLabel("Typo/formatting correction").check();
    await page.getByRole("button", { name: "Save suggestion" }).click();
    await expect(page.getByText("Suggested edits (1)")).toBeVisible();

    await selectText(source, "won big");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.getByLabel("Comment", { exact: true }).fill("Add the score?");
    await page.getByRole("button", { name: "Save comment" }).click();
    await expect(page.getByText("Comments on the text (1)")).toBeVisible();

    await page.getByLabel("General feedback").fill("Fun read.");
    await page.getByLabel("General feedback").blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Submit review" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Submit", exact: true })
      .click();
    // Submit navigates with a full page load; allow for a cold dev route
    // under full-suite load.
    await expect(
      page.getByRole("heading", { name: "Review suggestions" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Human · ${reviewer.userName}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply selected changes" }),
    ).toHaveCount(0);

    // Owner: submitted status, applies the correction, discusses.
    await context.clearCookies();
    await context.addCookies([owner.cookie]);
    await page.goto("/admin");
    await expect(
      page.locator("li", { hasText: post.title }).first(),
    ).toContainText("Review submitted");
    await page.goto(`/admin/posts/${post.id}/reviews`);
    await page.getByRole("link", { name: /Open review/ }).click();
    await expect(page.getByText("Fun read.")).toBeVisible();
    await expect(page.getByText("Add the score?")).toBeVisible();

    const change = page
      .locator("div", { hasText: "Body change 1" })
      .filter({
        has: page.getByRole("checkbox"),
      })
      .last();
    await change.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Apply selected changes" }).click();
    await page.getByRole("button", { name: "Confirm apply" }).click();
    await expect(page.getByText("Selected changes saved.")).toBeVisible();

    await page
      .getByLabel("Comment on this review")
      .fill("Thanks, applied the typo fix.");
    await page
      .getByRole("button", { name: "Comment", exact: true })
      .last()
      .click();
    const thread = page.getByRole("article", {
      name: `Comment from ${owner.userName}`,
    });
    await expect(thread).toContainText("Thanks, applied the typo fix.");
    await thread.getByRole("button", { name: "Resolve" }).click();
    await expect(thread.getByText(/^Resolved/)).toBeVisible();
  } finally {
    await post.cleanup();
    await reviewer.cleanup();
    await owner.cleanup();
    await category.cleanup();
  }
});
