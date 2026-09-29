import { describe, expect, it } from "vitest";
import { applyProposalSelection, createRangeDiff } from "@/lib/proposals/diff";
import type { ProposalSnapshot } from "@/lib/proposals/input";
import { CORRECTION_EXPLANATION, ReviewStatus } from "./input";
import {
  draftProblem,
  headlineStatus,
  humanReviewNotes,
  locatePrevious,
  rawOffset,
  previousSuggestions,
  reviewerStatus,
} from "./suggestions";

const body = "The Bears won big.\n\nTeh defense was great.\n";
const base: ProposalSnapshot = {
  title: "T",
  slug: "t",
  bodyMd: body,
  categoryId: 1,
  tags: [],
  thumbnailUrl: "",
  bannerUrl: null,
  videoUrl: null,
};
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const at = (text: string) => ({
  start: body.indexOf(text),
  end: body.indexOf(text) + text.length,
  before: text,
});
const typo = {
  id: id(1),
  ...at("Teh"),
  after: "The",
  correction: true,
  explanation: "",
};
const substantive = {
  id: id(2),
  ...at("won big"),
  after: "won 31-10",
  correction: false,
  explanation: "Use the real score.",
};

describe("createRangeDiff", () => {
  it("makes one change per suggestion in text order and reconstructs", () => {
    const { diff, candidate } = createRangeDiff(base, [typo, substantive]);
    expect(candidate.bodyMd).toBe(
      "The Bears won 31-10.\n\nThe defense was great.\n",
    );
    expect(diff.changes.map((c) => [c.id, c.before, c.after])).toEqual([
      ["body:0", "won big", "won 31-10"],
      ["body:1", "Teh", "The"],
    ]);
    const onlySecond = applyProposalSelection(base, candidate, diff, [
      "body:1",
    ]);
    expect(onlySecond.bodyMd).toBe(
      "The Bears won big.\n\nThe defense was great.\n",
    );
  });

  it.each([
    [
      "overlapping",
      [
        { start: 0, end: 5, after: "a" },
        { start: 3, end: 8, after: "b" },
      ],
    ],
    ["empty", [{ start: 4, end: 4, after: "a" }]],
    ["out of range", [{ start: 0, end: body.length + 1, after: "a" }]],
  ])("rejects %s ranges", (_label, ranges) => {
    expect(() => createRangeDiff(base, ranges)).toThrow();
  });

  it("a feedback-only review has no changes and an identical candidate", () => {
    const { diff, candidate } = createRangeDiff(base, []);
    expect(diff.changes).toEqual([]);
    expect(candidate).toEqual(base);
  });
});

describe("draftProblem", () => {
  const comment = {
    id: id(3),
    ...at("defense"),
    quote: "defense",
    body: "Nice.",
  };
  it("accepts matching, non-overlapping items", () => {
    expect(draftProblem(body, [typo, substantive], [comment])).toBeNull();
  });
  it.each([
    ["a suggestion whose text moved", [{ ...typo, start: typo.start + 1 }], []],
    ["a comment whose quote moved", [], [{ ...comment, start: 0 }]],
    [
      "overlapping suggestions",
      [
        substantive,
        {
          ...substantive,
          id: id(4),
          start: substantive.start + 1,
          before: body.slice(substantive.start + 1, substantive.end),
        },
      ],
      [],
    ],
    ["duplicate ids", [typo], [{ ...comment, id: typo.id }]],
  ] as const)("rejects %s", (_label, suggestions, comments) => {
    expect(draftProblem(body, [...suggestions], [...comments])).not.toBeNull();
  });
});

describe("explanations", () => {
  it("binds each explanation to its exact change, filling the correction shortcut", () => {
    const { diff } = createRangeDiff(base, [typo, substantive]);
    const notes = humanReviewNotes(diff, [typo, substantive], "Solid post.");
    expect(notes.summary).toBe("Solid post.");
    expect(notes.changes).toEqual([
      {
        changeId: "body:0",
        before: "won big",
        after: "won 31-10",
        explanation: "Use the real score.",
        sources: [],
      },
      {
        changeId: "body:1",
        before: "Teh",
        after: "The",
        explanation: CORRECTION_EXPLANATION,
        sources: [],
      },
    ]);
    expect(previousSuggestions(diff, notes)).toEqual([
      {
        before: "won big",
        after: "won 31-10",
        explanation: "Use the real score.",
        correction: false,
      },
      {
        before: "Teh",
        after: "The",
        explanation: CORRECTION_EXPLANATION,
        correction: true,
      },
    ]);
  });
});

describe("locatePrevious", () => {
  it.each([
    [
      "a unique match",
      "Teh",
      { start: body.indexOf("Teh"), end: body.indexOf("Teh") + 3 },
    ],
    ["missing text", "Packers", null],
    ["an ambiguous match", "e", null],
  ])("%s", (_label, before, expected) => {
    expect(locatePrevious(body, before)).toEqual(expected);
  });
});

describe("reviewerStatus", () => {
  const t = (n: number) => new Date(2026, 8, n);
  it.each([
    [
      "draft wins",
      {
        hasDraft: true,
        requestedAt: t(1),
        latestReview: { createdAt: t(2), open: true },
      },
      ReviewStatus.InProgress,
    ],
    [
      "request with no review",
      { hasDraft: false, requestedAt: t(1), latestReview: null },
      ReviewStatus.Requested,
    ],
    [
      "re-request after an older review",
      {
        hasDraft: false,
        requestedAt: t(3),
        latestReview: { createdAt: t(2), open: true },
      },
      ReviewStatus.Requested,
    ],
    [
      "open review answering the request",
      {
        hasDraft: false,
        requestedAt: t(1),
        latestReview: { createdAt: t(2), open: true },
      },
      ReviewStatus.Submitted,
    ],
    [
      "unrequested open review",
      {
        hasDraft: false,
        requestedAt: null,
        latestReview: { createdAt: t(2), open: true },
      },
      ReviewStatus.Submitted,
    ],
    [
      "closed review",
      {
        hasDraft: false,
        requestedAt: t(1),
        latestReview: { createdAt: t(2), open: false },
      },
      null,
    ],
    [
      "nothing",
      { hasDraft: false, requestedAt: null, latestReview: null },
      null,
    ],
  ] as const)("%s", (_label, input, expected) => {
    expect(reviewerStatus(input)).toBe(expected);
  });

  it("headline puts submitted feedback first", () => {
    expect(
      headlineStatus([ReviewStatus.Requested, ReviewStatus.Submitted, null]),
    ).toBe(ReviewStatus.Submitted);
    expect(
      headlineStatus([ReviewStatus.Requested, ReviewStatus.InProgress]),
    ).toBe(ReviewStatus.InProgress);
    expect(headlineStatus([null])).toBeNull();
  });
});

describe("rawOffset", () => {
  const crlf = "One\r\nTwo\r\nThree";
  // What a textarea shows: CRLF collapsed to LF.
  const shown = crlf.replace(/\r\n/g, "\n");
  it.each(["One", "Two", "Three", "o\nTh"])(
    "maps a textarea selection of %j back to the exact raw text",
    (needle) => {
      const start = shown.indexOf(needle);
      const raw = crlf.slice(
        rawOffset(crlf, start),
        rawOffset(crlf, start + needle.length),
      );
      expect(raw.replace(/\r\n/g, "\n")).toBe(needle);
    },
  );
  it("is the identity for LF-only text", () => {
    expect(rawOffset(body, 12)).toBe(12);
  });
});
