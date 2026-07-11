import { describe, expect, it } from "vitest";

import { toDateTimeLocalValue } from "@/lib/shared/datetime";

describe("toDateTimeLocalValue", () => {
  it.each([
    [
      "pads single-digit month, day, hour, minute",
      2024,
      0,
      5,
      9,
      7,
      "2024-01-05T09:07",
    ],
    ["handles midnight", 2024, 5, 15, 0, 0, "2024-06-15T00:00"],
    ["handles end-of-year", 2024, 11, 31, 23, 59, "2024-12-31T23:59"],
    [
      "leaves double-digit values unpadded",
      2024,
      9,
      12,
      14,
      45,
      "2024-10-12T14:45",
    ],
  ])("%s", (_name, year, month, day, hour, minute, expected) => {
    const date = new Date(year, month, day, hour, minute);
    expect(toDateTimeLocalValue(date)).toBe(expected);
  });
});
