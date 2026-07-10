import { describe, expect, it } from "vitest";

import {
  httpsImageUrl,
  postInputSchema,
  postUpdateSchema,
  slugifyTitle,
  tagToSlug,
} from "./input";

describe("slugifyTitle", () => {
  it("lowercases and strips diacritics", () => {
    expect(slugifyTitle("Café Résumé")).toBe("cafe-resume");
  });

  it("collapses runs of non-alphanumeric characters into a single hyphen", () => {
    expect(slugifyTitle("Hello,   World!! -- Again")).toBe("hello-world-again");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyTitle("--Leading and Trailing--")).toBe(
      "leading-and-trailing",
    );
  });

  it("falls back to 'post' for an all-emoji title", () => {
    expect(slugifyTitle("🔥🔥🔥")).toBe("post");
  });

  it("truncates to 80 characters and trims a trailing hyphen after truncation", () => {
    const longTitle = "word ".repeat(30).trim();
    const slug = slugifyTitle(longTitle);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("tagToSlug", () => {
  it("lowercases and strips diacritics, same as slugifyTitle", () => {
    expect(tagToSlug("Café")).toBe("cafe");
  });

  it("returns '' (no 'post' fallback) for an all-emoji tag name", () => {
    expect(tagToSlug("🔥🔥🔥")).toBe("");
  });

  it("returns '' for a CJK-only tag name that has no ASCII slug characters", () => {
    expect(tagToSlug("日本語")).toBe("");
  });
});

describe("httpsImageUrl", () => {
  it("accepts an https URL", () => {
    expect(httpsImageUrl.safeParse("https://example.com/a.jpg").success).toBe(
      true,
    );
  });

  it("rejects an http URL", () => {
    expect(httpsImageUrl.safeParse("http://example.com/a.jpg").success).toBe(
      false,
    );
  });

  it("rejects a non-URL string", () => {
    expect(httpsImageUrl.safeParse("not a url").success).toBe(false);
  });
});

describe("postInputSchema", () => {
  const valid = {
    title: "A Title",
    bodyMd: "Some body.",
    categoryId: 1,
  };

  it("accepts an empty thumbnailUrl", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      thumbnailUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an https thumbnailUrl", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      thumbnailUrl: "https://example.com/thumb.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an http thumbnailUrl", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      thumbnailUrl: "http://example.com/thumb.jpg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 tags", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("accepts up to 10 tags", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an all-emoji tag name instead of letting it collapse to a shared slug", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      tags: ["🔥🔥🔥"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a videoUrl over 2048 characters", () => {
    const longUrl = `https://example.com/${"a".repeat(2048)}`;
    const result = postInputSchema.safeParse({
      ...valid,
      videoUrl: longUrl,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = postInputSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    const result = postInputSchema.safeParse({
      ...valid,
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a slug containing spaces", () => {
    const result = postInputSchema.safeParse({ ...valid, slug: "Foo Bar" });
    expect(result.success).toBe(false);
  });

  it("rejects a slug with a leading hyphen", () => {
    const result = postInputSchema.safeParse({ ...valid, slug: "-lead" });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed slug", () => {
    const result = postInputSchema.safeParse({ ...valid, slug: "foo-bar" });
    expect(result.success).toBe(true);
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
