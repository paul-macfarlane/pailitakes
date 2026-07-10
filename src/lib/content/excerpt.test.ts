import { describe, expect, it } from "vitest";

import { deriveExcerpt, EXCERPT_MAX_LENGTH } from "./excerpt";

describe("deriveExcerpt", () => {
  it("returns plain prose unchanged when short", () => {
    expect(deriveExcerpt("Jokic dropped 30 again.")).toBe(
      "Jokic dropped 30 again.",
    );
  });

  it("strips markdown syntax but keeps the text", () => {
    expect(
      deriveExcerpt(
        "# Big News\n\nThe **Nuggets** won [the game](https://example.com) *easily*.",
      ),
    ).toBe("Big News The Nuggets won the game easily.");
  });

  it("skips code blocks", () => {
    expect(
      deriveExcerpt("```js\nconst secret = 1;\n```\n\nProse after code."),
    ).toBe("Prose after code.");
  });

  it("skips bare-URL blocks (e.g. YouTube embeds)", () => {
    expect(
      deriveExcerpt(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nWhat a highlight reel.",
      ),
    ).toBe("What a highlight reel.");
    expect(deriveExcerpt("www.youtube.com/watch?v=dQw4w9WgXcQ\n\nMore.")).toBe(
      "More.",
    );
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const long = `${"word ".repeat(50)}end`;
    const excerpt = deriveExcerpt(long);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/wor…$/);
  });

  it("does not add an ellipsis when the text fits exactly", () => {
    const text = "a".repeat(EXCERPT_MAX_LENGTH);
    expect(deriveExcerpt(text)).toBe(text);
  });

  it("collapses newlines and repeated whitespace", () => {
    expect(deriveExcerpt("Line one\nline two.\n\nNext   para.")).toBe(
      "Line one line two. Next para.",
    );
  });

  it("tolerates markdown truncated mid-construct (excerptSource contract)", () => {
    // Simulates left(body_md, N) cutting inside a link destination.
    const truncated = "Great highlight [watch the clip](https://exa";
    const excerpt = deriveExcerpt(truncated, { sourceTruncated: true });
    expect(excerpt).toContain("Great highlight");
    expect(excerpt).not.toContain("](");
  });

  it("keeps a trailing bracket fragment when the source was NOT truncated", () => {
    // A full body ending in authored bracket text is real prose, not a
    // truncation artifact.
    expect(deriveExcerpt("Full breakdown coming in part [2")).toBe(
      "Full breakdown coming in part [2",
    );
  });

  it("drops the final (possibly cut) word of a truncated source it consumed fully", () => {
    const excerpt = deriveExcerpt("The take continues with more analys", {
      sourceTruncated: true,
    });
    expect(excerpt).toBe("The take continues with more…");
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(deriveExcerpt("")).toBe("");
    expect(deriveExcerpt("  \n ")).toBe("");
  });

  it("returns an empty string when nothing but code/URLs exist", () => {
    expect(
      deriveExcerpt("```\ncode only\n```\n\nhttps://youtu.be/dQw4w9WgXcQ"),
    ).toBe("");
  });

  it("hard-cuts a single overlong word rather than returning nothing", () => {
    const excerpt = deriveExcerpt("x".repeat(400));
    expect(excerpt.length).toBe(EXCERPT_MAX_LENGTH + 1);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
