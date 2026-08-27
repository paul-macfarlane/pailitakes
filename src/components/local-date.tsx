"use client";

import { useSyncExternalStore } from "react";

import { DateDisplay, formatDisplayDate } from "@/lib/shared/datetime";

const subscribeNoop = () => () => {};
const SERVER_TIME_ZONE = "UTC";
const getViewerTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => SERVER_TIME_ZONE;

// Public pages are ISR (design §3): one cached HTML for every viewer, so the
// server can only render dates in a fixed zone. useSyncExternalStore hydrates
// with the UTC server snapshot and then re-renders once with the viewer's
// zone — the same zero-mismatch idiom as theme-toggle.tsx, and why no
// suppressHydrationWarning is needed (ADR-0028). Everything that renders a
// timestamp goes through this hook so every surface agrees on the day.
export function useViewerTimeZone(): string {
  return useSyncExternalStore(
    subscribeNoop,
    getViewerTimeZone,
    getServerTimeZone,
  );
}

// `iso` rather than a Date so server components can pass it straight from
// the DB row and the client bundle never re-parses a serialized Date.
export function LocalDate({
  iso,
  display = DateDisplay.Date,
}: {
  iso: string;
  display?: DateDisplay;
}) {
  const timeZone = useViewerTimeZone();
  return (
    <time dateTime={iso}>
      {formatDisplayDate(new Date(iso), display, timeZone)}
    </time>
  );
}
