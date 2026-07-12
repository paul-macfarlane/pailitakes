import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementInputSchema,
} from "@/lib/announcements/input";

describe("announcementInputSchema", () => {
  it.each([
    ["empty body", "", false],
    ["whitespace-only body", "   ", false],
    [
      "body over the 500-char cap",
      "a".repeat(ANNOUNCEMENT_MAX_LENGTH + 1),
      false,
    ],
    ["body at the 500-char cap", "a".repeat(ANNOUNCEMENT_MAX_LENGTH), true],
  ])("%s -> valid: %s", (_label, body, expectedSuccess) => {
    const result = announcementInputSchema.safeParse({ body });
    expect(result.success).toBe(expectedSuccess);
  });

  it("trims surrounding whitespace", () => {
    const result = announcementInputSchema.parse({ body: "  Big news!  " });
    expect(result.body).toBe("Big news!");
  });
});
