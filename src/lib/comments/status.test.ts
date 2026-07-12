import { describe, expect, it } from "vitest";

import { commentStatus } from "@/db/schema";
import { COMMENT_STATUSES } from "@/lib/comments/status";

describe("COMMENT_STATUSES", () => {
  it("matches the comment_status pg enum exactly (no drift)", () => {
    expect([...COMMENT_STATUSES].sort()).toEqual(
      [...commentStatus.enumValues].sort(),
    );
  });
});
