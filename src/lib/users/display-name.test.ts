import { describe, expect, it } from "vitest";

import {
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
} from "./display-name";

describe("normalizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDisplayName("  Paul   Macfarlane ")).toBe(
      "Paul Macfarlane",
    );
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   \t\n ")).toBeNull();
  });

  it("keeps a normal name unchanged", () => {
    expect(normalizeDisplayName("Paul")).toBe("Paul");
  });
});

describe("isValidDisplayName", () => {
  it("rejects empty and whitespace-only names", () => {
    expect(isValidDisplayName("")).toBe(false);
    expect(isValidDisplayName("   ")).toBe(false);
  });

  it("rejects names over the max length", () => {
    expect(isValidDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toBe(
      false,
    );
  });

  it("accepts a name exactly at the max length", () => {
    expect(isValidDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH))).toBe(true);
  });
});
