import { describe, expect, it } from "vitest";

import {
  type HomeCanonical,
  homeCanonical,
  pageParamsSchema,
  searchParamsSchema,
  type SearchPageParams,
  SEARCH_QUERY_MAX,
} from "./search-params";

describe("searchParamsSchema", () => {
  describe("q", () => {
    it.each([
      ["a normal query passes through trimmed", "  nfl draft  ", "nfl draft"],
      [
        "an oversized query degrades to undefined",
        "a".repeat(SEARCH_QUERY_MAX + 1),
        undefined,
      ],
      ["a whitespace-only query degrades to undefined", "   ", undefined],
      ["an empty string degrades to undefined", "", undefined],
      ["missing entirely degrades to undefined", undefined, undefined],
      [
        "exactly at the max length passes through",
        "a".repeat(SEARCH_QUERY_MAX),
        "a".repeat(SEARCH_QUERY_MAX),
      ],
    ] satisfies [
      name: string,
      input: string | undefined,
      expected: string | undefined,
    ][])("%s", (_name, input, expected) => {
      const parsed = searchParamsSchema.parse({ q: input });
      expect(parsed.q).toBe(expected);
    });
  });

  describe("category", () => {
    it.each([
      ["a slug-shaped value passes through", "nfl-draft", "nfl-draft"],
      ["a single-segment slug passes through", "nfl", "nfl"],
      ["uppercase degrades to undefined", "NFL", undefined],
      ["spaces degrade to undefined", "nfl draft", undefined],
      ["a leading hyphen degrades to undefined", "-nfl", undefined],
      ["an empty string degrades to undefined", "", undefined],
      ["missing entirely degrades to undefined", undefined, undefined],
    ] satisfies [
      name: string,
      input: string | undefined,
      expected: string | undefined,
    ][])("%s", (_name, input, expected) => {
      const parsed = searchParamsSchema.parse({ category: input });
      expect(parsed.category).toBe(expected);
    });
  });

  describe("page", () => {
    it.each([
      ["a positive integer string passes through", "3", 3],
      ["junk text falls back to 1", "abc", 1],
      ["zero falls back to 1", "0", 1],
      ["a negative number falls back to 1", "-2", 1],
      ["a decimal falls back to 1", "1.5", 1],
      ["missing entirely falls back to 1", undefined, 1],
      ["a value over the ceiling falls back to 1", "999999999", 1],
    ] satisfies [name: string, input: string | undefined, expected: number][])(
      "%s",
      (_name, input, expected) => {
        const parsed = searchParamsSchema.parse({ page: input });
        expect(parsed.page).toBe(expected);
      },
    );
  });
});

// /tags/[slug]'s page-only schema shares searchParamsSchema's `page` field
// definition (search-params.ts) — this pins that the shared behavior still
// holds through the separate export, not a re-proof of every case above.
describe("pageParamsSchema", () => {
  it.each([
    ["junk text falls back to 1", "abc", 1],
    ["a value over the ceiling falls back to 1", "999999999", 1],
    ["a positive integer string passes through", "3", 3],
  ] satisfies [name: string, input: string | undefined, expected: number][])(
    "%s",
    (_name, input, expected) => {
      const parsed = pageParamsSchema.parse({ page: input });
      expect(parsed.page).toBe(expected);
    },
  );
});

describe("homeCanonical", () => {
  it.each([
    ["bare feed", {}, { canonical: "/", noindex: false }],
    [
      "category-browse mode self-canonicalises",
      { category: "nfl" },
      { canonical: "/?category=nfl", noindex: false },
    ],
    [
      "search mode collapses to / and is noindex",
      { q: "draft" },
      { canonical: "/", noindex: true },
    ],
    [
      "search + category is still search mode",
      { q: "draft", category: "nfl", page: 3 },
      { canonical: "/", noindex: true },
    ],
    [
      "paginated feed keeps its page",
      { page: 2 },
      { canonical: "/?page=2", noindex: false },
    ],
    [
      "paginated category keeps category and page",
      { category: "nfl", page: 2 },
      { canonical: "/?category=nfl&page=2", noindex: false },
    ],
    [
      "page 1 is omitted",
      { category: "nfl", page: 1 },
      { canonical: "/?category=nfl", noindex: false },
    ],
  ] satisfies [
    name: string,
    input: Partial<SearchPageParams>,
    expected: HomeCanonical,
  ][])("%s", (_name, input, expected) => {
    expect(homeCanonical({ page: 1, ...input })).toEqual(expected);
  });
});
