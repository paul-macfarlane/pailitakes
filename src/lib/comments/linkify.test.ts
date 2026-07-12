import { describe, expect, it } from "vitest";

import { linkifyText } from "@/lib/comments/linkify";

describe("linkifyText", () => {
  it("returns a single text segment for plain text with no URL", () => {
    expect(linkifyText("just a normal comment")).toEqual([
      { type: "text", value: "just a normal comment" },
    ]);
  });

  it("returns a single url segment for a bare URL", () => {
    expect(linkifyText("https://example.com/path")).toEqual([
      { type: "url", value: "https://example.com/path" },
    ]);
  });

  it("splits text around a URL in the middle of a sentence", () => {
    expect(linkifyText("check https://example.com out")).toEqual([
      { type: "text", value: "check " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " out" },
    ]);
  });

  it("links multiple URLs in the same body", () => {
    expect(linkifyText("https://a.com and https://b.com")).toEqual([
      { type: "url", value: "https://a.com" },
      { type: "text", value: " and " },
      { type: "url", value: "https://b.com" },
    ]);
  });

  it.each([
    ["trailing period", "See https://example.com.", "https://example.com"],
    [
      "trailing comma",
      "Visit https://example.com, thanks",
      "https://example.com",
    ],
    ["wrapping parens", "(https://example.com)", "https://example.com"],
  ])("strips %s from the linked URL", (_label, input, expectedUrl) => {
    const segments = linkifyText(input);
    const urlSegment = segments.find((s) => s.type === "url");
    expect(urlSegment?.value).toBe(expectedUrl);
    // Round-trip fidelity: no character of the original body is dropped —
    // the stripped punctuation must still show up as surrounding text.
    expect(segments.map((s) => s.value).join("")).toBe(input);
  });

  it("keeps a balanced trailing paren that belongs to the URL", () => {
    const input = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(linkifyText(input)).toEqual([{ type: "url", value: input }]);
  });

  it("preserves embedded newlines within text segments", () => {
    expect(linkifyText("line one\nline two")).toEqual([
      { type: "text", value: "line one\nline two" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(linkifyText("")).toEqual([]);
  });
});
