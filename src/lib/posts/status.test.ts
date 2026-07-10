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

  it("hides drafts and archived posts regardless of timestamps", () => {
    expect(
      isPubliclyVisible(
        { status: "draft", publishAt: past, archiveAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isPubliclyVisible(
        { status: "archived", publishAt: past, archiveAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("treats a scheduled post whose publish time has passed as live", () => {
    expect(
      isPubliclyVisible(
        { status: "scheduled", publishAt: past, archiveAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("hides a scheduled/published post whose publish time is still in the future", () => {
    expect(
      isPubliclyVisible(
        { status: "scheduled", publishAt: future, archiveAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isPubliclyVisible(
        { status: "published", publishAt: future, archiveAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("hides a published post whose archive time has passed", () => {
    expect(
      isPubliclyVisible(
        { status: "published", publishAt: past, archiveAt: past },
        now,
      ),
    ).toBe(false);
    expect(
      isPubliclyVisible(
        { status: "published", publishAt: past, archiveAt: future },
        now,
      ),
    ).toBe(true);
  });

  it("hides a published post with no publish date", () => {
    expect(
      isPubliclyVisible(
        { status: "published", publishAt: null, archiveAt: null },
        now,
      ),
    ).toBe(false);
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
