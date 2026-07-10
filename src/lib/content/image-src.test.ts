import { describe, expect, it } from "vitest";

import { isRenderableImageSrc, postHeroSrc } from "./image-src";

describe("isRenderableImageSrc", () => {
  it.each([
    ["https URL", "https://example.com/a.jpg", true],
    ["http URL (mixed content)", "http://example.com/a.jpg", false],
    ["relative path", "/images/a.jpg", false],
    ["javascript scheme", "javascript:alert(1)", false],
    ["empty string", "", false],
    ["null", null, false],
    ["undefined", undefined, false],
  ])("%s → %s", (_label, src, expected) => {
    expect(isRenderableImageSrc(src)).toBe(expected);
  });
});

describe("postHeroSrc", () => {
  const thumbnailUrl = "https://example.com/thumb.jpg";

  it("prefers the banner when renderable", () => {
    expect(
      postHeroSrc({
        bannerUrl: "https://example.com/banner.jpg",
        thumbnailUrl,
      }),
    ).toBe("https://example.com/banner.jpg");
  });

  it("falls back to the thumbnail when the banner is null", () => {
    expect(postHeroSrc({ bannerUrl: null, thumbnailUrl })).toBe(thumbnailUrl);
  });

  it("falls back to the thumbnail when the banner is not renderable", () => {
    expect(
      postHeroSrc({ bannerUrl: "http://example.com/banner.jpg", thumbnailUrl }),
    ).toBe(thumbnailUrl);
    expect(postHeroSrc({ bannerUrl: "", thumbnailUrl })).toBe(thumbnailUrl);
  });

  it("returns null when neither is renderable", () => {
    expect(
      postHeroSrc({
        bannerUrl: null,
        thumbnailUrl: "http://example.com/t.jpg",
      }),
    ).toBeNull();
  });
});
