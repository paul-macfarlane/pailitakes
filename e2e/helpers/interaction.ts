import { expect, type Locator, type Page } from "@playwright/test";

// App Router client islands (the editor, status/schedule/user controls) only
// respond to a click once React has hydrated, and there's no cheap global
// "hydrated" signal to await. Retry the click until its effect is observable
// (asserted inside `confirm`), and skip the click once the trigger is gone so
// an already-applied, single-shot action doesn't fail the retry loop.
export async function clickUntil(
  trigger: Locator,
  confirm: () => Promise<void>,
  timeout = 15000,
): Promise<void> {
  await expect(async () => {
    if (await trigger.isVisible()) await trigger.click();
    await confirm();
  }).toPass({ timeout });
}

// Opens the admin mobile nav sheet when the hamburger is present (phone
// projects); no-op at desktop widths where the links are inline. The
// hamburger only responds once React has hydrated (same caveat as
// clickUntil above), and the sheet may already be open from a prior call —
// tolerate both by retrying the click until the sheet is visible.
export async function openAdminNav(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Admin navigation" });
  if (!(await trigger.isVisible())) return;

  const sheet = page.getByRole("dialog", { name: "Admin navigation" });
  await expect(async () => {
    if (!(await sheet.isVisible())) await trigger.click();
    await expect(sheet).toBeVisible();
  }).toPass();
}
