import { describe, expect, it } from "vitest";

import {
  DateDisplay,
  formatDisplayDate,
  isSameCalendarDay,
  toDateTimeLocalValue,
} from "@/lib/shared/datetime";

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

describe("formatDisplayDate", () => {
  // 8pm ET on Aug 27 is 00:00 UTC on Aug 28 — the exact bug SEO-8 fixes.
  const lateEvening = new Date("2026-08-28T00:00:00Z");

  it.each([
    ["date, UTC", DateDisplay.Date, "UTC", "Aug 28, 2026"],
    ["date, New York", DateDisplay.Date, "America/New_York", "Aug 27, 2026"],
    ["datetime, UTC", DateDisplay.DateTime, "UTC", "Aug 28, 2026, 12:00 AM"],
    [
      "datetime, New York",
      DateDisplay.DateTime,
      "America/New_York",
      "Aug 27, 2026, 8:00 PM",
    ],
  ] satisfies [string, DateDisplay, string, string][])(
    "%s",
    (_name, display, timeZone, expected) => {
      expect(formatDisplayDate(lateEvening, display, timeZone)).toBe(expected);
    },
  );
});

describe("isSameCalendarDay", () => {
  const a = new Date("2026-08-27T23:30:00Z");
  const b = new Date("2026-08-28T01:30:00Z");

  it.each([
    ["straddles midnight UTC", "UTC", false],
    ["same evening in New York", "America/New_York", true],
    ["same morning in Tokyo", "Asia/Tokyo", true],
    [
      "straddles midnight in the Azores (UTC+0 in summer)",
      "Atlantic/Azores",
      false,
    ],
    ["same night in London (BST, UTC+1)", "Europe/London", true],
  ] satisfies [string, string, boolean][])(
    "%s",
    (_name, timeZone, expected) => {
      expect(isSameCalendarDay(a, b, timeZone)).toBe(expected);
    },
  );

  it("is reflexive", () => {
    expect(isSameCalendarDay(a, a, "Pacific/Chatham")).toBe(true);
  });
});
