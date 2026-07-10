import { describe, expect, it } from "vitest";

import {
  httpsImageUrl,
  postInputSchema,
  postUpdateSchema,
  slugifyTitle,
  tagToSlug,
} from "./input";

describe("slugifyTitle", () => {
  // Table-driven (5c): each case is a pure `input -> expected` equality
  // check on the same function — see the `it.each` cases arrays throughout
  // this file for the convention (name goes in the format string via `%s`).
  it.each([
    ["lowercases and strips diacritics", "Café Résumé", "cafe-resume"],
    [
      "collapses runs of non-alphanumeric characters into a single hyphen",
      "Hello,   World!! -- Again",
      "hello-world-again",
    ],
    [
      "trims leading/trailing hyphens",
      "--Leading and Trailing--",
      "leading-and-trailing",
    ],
    ["falls back to 'post' for an all-emoji title", "🔥🔥🔥", "post"],
  ] satisfies [name: string, input: string, expected: string][])(
    "%s",
    (_name, input, expected) => {
      expect(slugifyTitle(input)).toBe(expected);
    },
  );

  it("truncates to 80 characters and trims a trailing hyphen after truncation", () => {
    const longTitle = "word ".repeat(30).trim();
    const slug = slugifyTitle(longTitle);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("tagToSlug", () => {
  it.each([
    ["lowercases and strips diacritics, same as slugifyTitle", "Café", "cafe"],
    ["returns '' (no 'post' fallback) for an all-emoji tag name", "🔥🔥🔥", ""],
    [
      "returns '' for a CJK-only tag name that has no ASCII slug characters",
      "日本語",
      "",
    ],
  ] satisfies [name: string, input: string, expected: string][])(
    "%s",
    (_name, input, expected) => {
      expect(tagToSlug(input)).toBe(expected);
    },
  );
});

describe("httpsImageUrl", () => {
  it.each([
    ["accepts an https URL", "https://example.com/a.jpg", true],
    ["rejects an http URL", "http://example.com/a.jpg", false],
    ["rejects a non-URL string", "not a url", false],
  ] satisfies [name: string, input: string, expected: boolean][])(
    "%s",
    (_name, input, expected) => {
      expect(httpsImageUrl.safeParse(input).success).toBe(expected);
    },
  );
});

describe("postInputSchema", () => {
  const valid = {
    title: "A Title",
    bodyMd: "Some body.",
    categoryId: 1,
  };

  // Table-driven (5c): every case below shares one body —
  // `postInputSchema.safeParse({ ...valid, ...override }).success === expected`
  // — differing only in which field is overridden and whether that override
  // should pass. Consolidates what were 12 separate `it` blocks (7 rejects +
  // 5 accepts) into one table of 12 rows; zero coverage change, only the
  // shape of the test count.
  const cases: [
    name: string,
    override: Record<string, unknown>,
    expected: boolean,
  ][] = [
    ["accepts an empty thumbnailUrl", { thumbnailUrl: "" }, true],
    [
      "accepts an https thumbnailUrl",
      { thumbnailUrl: "https://example.com/thumb.jpg" },
      true,
    ],
    [
      "rejects an http thumbnailUrl",
      { thumbnailUrl: "http://example.com/thumb.jpg" },
      false,
    ],
    [
      "rejects more than 10 tags",
      { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
      false,
    ],
    [
      "accepts up to 10 tags",
      { tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`) },
      true,
    ],
    [
      "rejects an all-emoji tag name instead of letting it collapse to a shared slug",
      { tags: ["🔥🔥🔥"] },
      false,
    ],
    [
      "rejects a videoUrl over 2048 characters",
      { videoUrl: `https://example.com/${"a".repeat(2048)}` },
      false,
    ],
    ["rejects an empty title", { title: "" }, false],
    ["rejects a title over 200 characters", { title: "a".repeat(201) }, false],
    ["rejects a slug containing spaces", { slug: "Foo Bar" }, false],
    ["rejects a slug with a leading hyphen", { slug: "-lead" }, false],
    ["accepts a well-formed slug", { slug: "foo-bar" }, true],
  ];

  it.each(cases)("%s", (_name, override, expected) => {
    const result = postInputSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(expected);
  });
});

describe("postUpdateSchema", () => {
  // Regression test for the bug this fixes: zod v4's `.partial()` still
  // applies `.default()` values to keys absent from the input, so a naive
  // `postInputSchema.partial()` would materialize thumbnailUrl/bannerUrl/
  // videoUrl/tags on a title-only autosave as though the author had
  // explicitly cleared them. postUpdateSchema is built from a base schema
  // with no defaults at all, so absent keys stay absent.
  it("parses a title-only update to exactly that one key, with no defaults materialized", () => {
    const result = postUpdateSchema.parse({ title: "x" });
    expect(result).toStrictEqual({ title: "x" });
  });

  it("parses an empty object to an empty object", () => {
    const result = postUpdateSchema.parse({});
    expect(result).toStrictEqual({});
  });
});
