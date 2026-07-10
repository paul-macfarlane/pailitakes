import { describe, expect, it } from "vitest";

import { postStatus } from "@/db/schema";
import {
  allowedTransitions,
  canScheduleArchive,
  canSchedulePublish,
  canTransition,
  isPubliclyVisible,
  POST_STATUSES,
  type PostStatus,
} from "@/lib/posts/status";

describe("POST_STATUSES", () => {
  it("matches the post_status pg enum exactly (no drift)", () => {
    expect([...POST_STATUSES].sort()).toEqual(
      [...postStatus.enumValues].sort(),
    );
  });
});

describe("canTransition", () => {
  it("allows publishing from draft, scheduled, and archived", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("scheduled", "published")).toBe(true);
    expect(canTransition("archived", "published")).toBe(true);
  });

  it("allows archiving from any non-archived status", () => {
    expect(canTransition("draft", "archived")).toBe(true);
    expect(canTransition("scheduled", "archived")).toBe(true);
    expect(canTransition("published", "archived")).toBe(true);
  });

  it("restores an archived post to draft or published (FR-1.6)", () => {
    expect(canTransition("archived", "draft")).toBe(true);
    expect(canTransition("archived", "published")).toBe(true);
  });

  it("never allows a no-op self-transition", () => {
    for (const status of POST_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("rejects moving into scheduled (that needs a timestamp — ADM-5)", () => {
    for (const from of POST_STATUSES) {
      expect(canTransition(from, "scheduled")).toBe(false);
    }
  });

  it("rejects archived -> archived and other disallowed pairs", () => {
    expect(canTransition("published", "scheduled")).toBe(false);
    expect(canTransition("draft", "draft")).toBe(false);
  });
});

describe("canSchedulePublish / canScheduleArchive", () => {
  it("schedules a publish only from draft or scheduled", () => {
    expect(canSchedulePublish("draft")).toBe(true);
    expect(canSchedulePublish("scheduled")).toBe(true);
    expect(canSchedulePublish("published")).toBe(false);
    expect(canSchedulePublish("archived")).toBe(false);
  });

  it("schedules an archive only from published or scheduled", () => {
    expect(canScheduleArchive("published")).toBe(true);
    expect(canScheduleArchive("scheduled")).toBe(true);
    expect(canScheduleArchive("draft")).toBe(false);
    expect(canScheduleArchive("archived")).toBe(false);
  });
});

describe("isPubliclyVisible", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const past = new Date("2026-06-01T00:00:00Z");
  const future = new Date("2026-08-01T00:00:00Z");

  // Table-driven (5c) visibility matrix: every case shares one body —
  // `isPubliclyVisible({ status, publishAt, archiveAt }, now) === expected`
  // — differing only in the status/timestamps. Consolidates what were 5 `it`
  // blocks (8 assertions total, two of them bundling 2 sub-cases each) into
  // one table of 8 rows; zero coverage change, only the shape of the count.
  it.each([
    ["hides a draft regardless of timestamps", "draft", past, null, false],
    [
      "hides an archived post regardless of timestamps",
      "archived",
      past,
      null,
      false,
    ],
    [
      "treats a scheduled post whose publish time has passed as live",
      "scheduled",
      past,
      null,
      true,
    ],
    [
      "hides a scheduled post whose publish time is still in the future",
      "scheduled",
      future,
      null,
      false,
    ],
    [
      "hides a published post whose publish time is still in the future",
      "published",
      future,
      null,
      false,
    ],
    [
      "hides a published post whose archive time has passed",
      "published",
      past,
      past,
      false,
    ],
    [
      "shows a published post before its archive time",
      "published",
      past,
      future,
      true,
    ],
    [
      "hides a published post with no publish date",
      "published",
      null,
      null,
      false,
    ],
  ] satisfies [
    name: string,
    status: PostStatus,
    publishAt: Date | null,
    archiveAt: Date | null,
    expected: boolean,
  ][])("%s", (_name, status, publishAt, archiveAt, expected) => {
    expect(isPubliclyVisible({ status, publishAt, archiveAt }, now)).toBe(
      expected,
    );
  });
});

describe("allowedTransitions", () => {
  it("returns a fresh array (mutating it doesn't corrupt the machine)", () => {
    const first = allowedTransitions("draft");
    first.push("scheduled" as PostStatus);
    expect(allowedTransitions("draft")).not.toContain("scheduled");
  });

  it("lists exactly the transitions canTransition permits", () => {
    for (const from of POST_STATUSES) {
      for (const to of POST_STATUSES) {
        expect(allowedTransitions(from).includes(to)).toBe(
          canTransition(from, to),
        );
      }
    }
  });
});
