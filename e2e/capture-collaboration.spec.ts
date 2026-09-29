import crypto from "node:crypto";

import { expect, test, type Locator } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
  shareTestPost,
} from "./helpers/session";

// Review evidence for COLLAB-3/4 UI (engineering rules: 390px + 1024px).
// Opt-in; writes to the ignored test-results/review-screenshots/.
test.skip(
  !process.env.COLLAB_CAPTURE,
  "set COLLAB_CAPTURE=1 for review screenshots",
);

async function selectText(source: Locator, text: string) {
  await source.evaluate((el, needle) => {
    const area = el as HTMLTextAreaElement;
    const start = area.value.indexOf(needle);
    area.focus();
    area.setSelectionRange(start, start + needle.length);
    area.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
}

test("capture human review surfaces", async ({ page, context }, info) => {
  test.skip(info.project.name !== "chromium", "one pass sets both widths");
  test.setTimeout(180_000);
  const out = "test-results/review-screenshots";
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author", userName: "Paul" });
  const reviewer = await createTestSession({
    role: "author",
    userName: `Bailey ${crypto.randomUUID().slice(0, 4)}`,
  });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "draft",
    title: "Bears defense carries a sloppy win",
    bodyMd:
      "The Bears won big on Sunday.\n\nTeh defense was great all afternoon, with three sacks in the fourth quarter.\n\nThe offense still needs work.\n",
  });
  await shareTestPost(post.id, reviewer.userId);
  const shots = async (name: string) => {
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      // Let the composer's sheet/side-panel switch finish animating.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${out}/${name}-${width}.png`,
        fullPage: true,
      });
    }
  };
  try {
    await context.addCookies([reviewer.cookie]);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Shared with me" }),
    ).toBeVisible();
    await shots("shared-with-me");
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
    await selectText(source, "won big");
    await page.getByRole("button", { name: "Suggest edit" }).click();
    await page.getByLabel("Replace with").fill("won 27-10");
    await page
      .getByLabel("Explain this change")
      .fill("Readers want the score.");
    await page.getByRole("button", { name: "Save suggestion" }).click();
    await selectText(source, "The offense still needs work.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await shots("review-composer");
    await page
      .getByLabel("Comment", { exact: true })
      .fill("Worth a sentence on the third downs?");
    await page.getByRole("button", { name: "Save comment" }).click();
    await page
      .getByLabel("General feedback")
      .fill("Fun read. Tighten the ending.");
    await expect(async () => {
      await page.getByRole("button", { name: "Suggest title" }).click();
      await expect(page.getByLabel("Suggested title")).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 15000 });
    await page
      .getByLabel("Suggested title")
      .fill("Bears defense bails out a sloppy win");
    await page.getByLabel("Explain this change").fill("Say who won it.");
    await shots("review-detail-composer");
    await page.getByRole("button", { name: "Save suggestion" }).click();
    await expect(page.getByText("Suggested edits (3)")).toBeVisible();
    await page.getByLabel("General feedback").blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await shots("review-workspace");
    await page.getByRole("button", { name: "Submit review" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Submit", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review suggestions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit review" }),
    ).toBeVisible();
    await shots("review-own-submitted");

    await context.clearCookies();
    await context.addCookies([owner.cookie]);
    await page.goto("/admin");
    await expect(page.getByText("Review submitted").first()).toBeVisible();
    await shots("dashboard-status");
    await page.goto(`/admin/posts/${post.id}/sharing`);
    await expect(page.getByText("Review submitted")).toBeVisible();
    await shots("sharing-status");
    await page.goto(`/admin/posts/${post.id}/reviews`);
    await page.getByRole("link", { name: /Open review/ }).click();
    const box = page.getByRole("textbox", {
      name: "Comment on body change 2",
    });
    await expect(async () => {
      await page
        .getByRole("button", { name: "Comment on body change 2" })
        .click();
      await expect(box).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await box.fill("Good call, adding it.");
    await page
      .getByRole("button", { name: "Comment", exact: true })
      .first()
      .click();
    await expect(
      page.locator("p", { hasText: "Good call, adding it." }),
    ).toBeVisible();
    const thread = page
      .getByRole("article", { name: "Comment from Paul" })
      .first();
    await thread.getByRole("button", { name: "Reply" }).click();
    await page.getByLabel("Reply").fill("Will do.");
    await page.getByRole("button", { name: "Post reply" }).click();
    await expect(thread.locator("p", { hasText: "Will do." })).toBeVisible();
    await shots("review-detail-discussion");
  } finally {
    await post.cleanup();
    await reviewer.cleanup();
    await owner.cleanup();
    await category.cleanup();
  }
});
