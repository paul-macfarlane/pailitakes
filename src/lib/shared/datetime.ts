// No "server-only" here (unlike most of src/lib): this feeds
// <input type="datetime-local"> values, so client components need it too.

// Formats a Date as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants.
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// The two shapes a timestamp renders in across the app (SEO-8): date-only for
// bylines and cards, date+time for comments and admin lists. Locale is fixed
// to en-US so the UTC server fallback and the viewer-zone client render differ
// by at most the calendar day, never by shape — the hydration swap stays
// nearly invisible (ADR-0028).
export const DateDisplay = {
  Date: "date",
  DateTime: "datetime",
} as const;
export type DateDisplay = (typeof DateDisplay)[keyof typeof DateDisplay];

// Server renders (ISR, cached once for every viewer) always pass "UTC"; the
// client passes the viewer's zone via useViewerTimeZone (local-date.tsx).
export function formatDisplayDate(
  date: Date,
  display: DateDisplay,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: display === DateDisplay.DateTime ? "short" : undefined,
    timeZone,
  }).format(date);
}

// Calendar-day equality in a given zone. Compares formatted y-m-d parts rather
// than arithmetic on epoch ms so DST shifts and non-integer-hour offsets are
// handled by Intl, not reimplemented here.
export function isSameCalendarDay(a: Date, b: Date, timeZone: string): boolean {
  const format = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return format.format(a) === format.format(b);
}
