import { expect, type Locator } from "@playwright/test";

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
