import { describe, expect, it } from "vitest";

import { buildUpdateDiff, toActionInput, type EditorValues } from "./autosave";

function values(overrides: Partial<EditorValues> = {}): EditorValues {
  return {
    title: "A title",
    slug: "",
    categoryId: 1,
    tags: "",
    bodyMd: "Body.",
    thumbnailUrl: "",
    bannerUrl: "",
    ...overrides,
  };
}

describe("toActionInput", () => {
  it("omits slug when the field is blank", () => {
    const input = toActionInput(values({ slug: "" }));
    expect(input.slug).toBeUndefined();
    expect("slug" in input).toBe(false);
  });

  it("includes an explicit slug", () => {
    const input = toActionInput(values({ slug: "my-slug" }));
    expect(input.slug).toBe("my-slug");
  });

  it("trims the title", () => {
    const input = toActionInput(values({ title: "  Padded  " }));
    expect(input.title).toBe("Padded");
  });

  it("splits, trims, and drops empty tags", () => {
    const input = toActionInput(values({ tags: " one , two ,, three ,   " }));
    expect(input.tags).toEqual(["one", "two", "three"]);
  });

  it("returns an empty tags array for a blank field", () => {
    const input = toActionInput(values({ tags: "" }));
    expect(input.tags).toEqual([]);
  });

  it("passes the thumbnail through (incl. the '' draft placeholder)", () => {
    expect(toActionInput(values({ thumbnailUrl: "" })).thumbnailUrl).toBe("");
    expect(
      toActionInput(values({ thumbnailUrl: "https://x/t.jpg" })).thumbnailUrl,
    ).toBe("https://x/t.jpg");
  });

  it("maps a blank banner to null and keeps a set banner", () => {
    expect(toActionInput(values({ bannerUrl: "" })).bannerUrl).toBeNull();
    expect(
      toActionInput(values({ bannerUrl: "https://x/b.jpg" })).bannerUrl,
    ).toBe("https://x/b.jpg");
  });
});

describe("buildUpdateDiff", () => {
  it("returns {} when nothing changed", () => {
    const prev = values();
    const next = values();
    expect(buildUpdateDiff(prev, next)).toEqual({});
  });

  it("includes only the field that changed (title)", () => {
    const prev = values();
    const next = values({ title: "New title" });
    expect(buildUpdateDiff(prev, next)).toEqual({ title: "New title" });
  });

  it("includes only the field that changed (categoryId)", () => {
    const prev = values();
    const next = values({ categoryId: 2 });
    expect(buildUpdateDiff(prev, next)).toEqual({ categoryId: 2 });
  });

  it("includes only the field that changed (bodyMd)", () => {
    const prev = values();
    const next = values({ bodyMd: "New body." });
    expect(buildUpdateDiff(prev, next)).toEqual({ bodyMd: "New body." });
  });

  it("maps a tags string change to a tags array", () => {
    const prev = values({ tags: "one" });
    const next = values({ tags: "one, two" });
    expect(buildUpdateDiff(prev, next)).toEqual({ tags: ["one", "two"] });
  });

  it("omits the slug key when the slug is cleared back to blank", () => {
    const prev = values({ slug: "explicit-slug" });
    const next = values({ slug: "" });
    const diff = buildUpdateDiff(prev, next);
    expect("slug" in diff).toBe(false);
    expect(diff).toEqual({});
  });

  it("includes slug when changed to a non-blank value", () => {
    const prev = values({ slug: "" });
    const next = values({ slug: "new-slug" });
    expect(buildUpdateDiff(prev, next)).toEqual({ slug: "new-slug" });
  });

  it("combines multiple simultaneous changes", () => {
    const prev = values();
    const next = values({ title: "New title", tags: "a, b" });
    expect(buildUpdateDiff(prev, next)).toEqual({
      title: "New title",
      tags: ["a", "b"],
    });
  });

  it("includes a changed thumbnail (including clearing it to '')", () => {
    expect(
      buildUpdateDiff(
        values({ thumbnailUrl: "https://x/t.jpg" }),
        values({ thumbnailUrl: "" }),
      ),
    ).toEqual({ thumbnailUrl: "" });
  });

  it("maps a changed banner to null when cleared, else the URL", () => {
    expect(
      buildUpdateDiff(values({ bannerUrl: "https://x/b.jpg" }), values()),
    ).toEqual({ bannerUrl: null });
    expect(
      buildUpdateDiff(values(), values({ bannerUrl: "https://x/b.jpg" })),
    ).toEqual({ bannerUrl: "https://x/b.jpg" });
  });
});
