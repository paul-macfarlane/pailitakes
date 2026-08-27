# 0028. Dates render in the viewer's timezone via a client island; same-day "Updated" is suppressed

- **Status:** Accepted
- **Date:** 2026-08-27
- **Related:** FR-9.2 (post page date / "Updated"), FR-9.4 (mobile-first), ADR-0016 (`content_updated_at`), technical-design.md §2 (client islands), §3 (ISR); backlog SEO-8, SEO-9

## Context

Every `Intl.DateTimeFormat` in the app was pinned `timeZone: "UTC"` — nine per-file copies across public cards, the byline, home announcements, comments, four admin lists, and the analytics axis. The pin existed so a cached ISR render (one HTML for every viewer, §3) could never disagree with a client render of the same date. Its side effect is a visible correctness bug: a post published at 8pm ET carries tomorrow's date for the author and their readers, and admin timestamps needed a literal " UTC" suffix to be interpretable.

A second, smaller issue fell out of ADR-0016: the byline is date-only, so an edit on the day of publish renders "Aug 27 · Updated Aug 27" — a repeat, not a signal. ADR-0016 accepted that; the owner reversed it once dates became local.

Options for local rendering: (a) keep UTC and add a zone suffix — honest but still the wrong day for everyone not in UTC; (b) per-viewer server rendering — forfeits ISR for every public page over a date string; (c) render a UTC fallback on the server and re-format on the client after hydration.

## Decision

- One shared client island, `src/components/local-date.tsx`: `useViewerTimeZone()` is a `useSyncExternalStore` whose server snapshot is `"UTC"` and whose client snapshot is the browser's resolved zone; `<LocalDate iso display>` renders `<time dateTime={iso}>` through it. React hydrates against the server snapshot and re-renders once with the client one, so there is no hydration mismatch and no `suppressHydrationWarning` (the backlog task proposed that escape hatch; the store idiom — already used by `theme-toggle.tsx` — makes it unnecessary).
- Formatting is one function, `formatDisplayDate(date, DateDisplay, timeZone)` in `src/lib/shared/datetime.ts`, locale fixed to `en-US`. The fixed locale is deliberate: server fallback and client render then differ only in the calendar day, never in shape, so the post-hydration swap is nearly invisible. `DateDisplay` (`Date` | `DateTime`) is the only variation — bylines and cards are date-only; comments and admin lists add time.
- **Same-local-day "Updated" suppression (SEO-9):** `showsUpdatedDate(publishAt, contentUpdatedAt, timeZone)` now also requires the two to fall on different calendar days in the given zone (`isSameCalendarDay`). The decision runs in `<PostDates>`, a client island beside the byline, because it depends on the viewer's zone: the server renders the UTC answer, the client re-decides. Edits within a day of publish may therefore show or hide the label right after hydration — accepted, the alternative (client-only rendering) costs no-JS readers the label and shifts layout on every post.
- **The analytics axis stays UTC-pinned.** Its buckets are UTC calendar-day aggregates (`src/lib/analytics/data.ts`); a local-zone tick would disagree with the bucket boundary. The chart is labelled "Buckets are UTC calendar days" instead. The admin " UTC" suffixes are dropped everywhere else.

## Consequences

- Easier: one formatter, one hook, one place to change date shape. Every surface agrees on the day for a given viewer. Admin timestamps read naturally.
- Harder: every date is now a client-island boundary (tiny — a `<time>` element per date), and any new date surface must use `<LocalDate>` rather than `Intl` directly, or it reintroduces the disagreement. Unit tests pass an explicit `timeZone`; there is no implicit default, so a server caller cannot accidentally format in the host's zone.
- ADR-0016's "same-day edits render an identical Updated date (accepted)" consequence is superseded by this decision.
- Revisit if: a viewer-locale request arrives (drop the `en-US` pin and accept a visible shape swap on hydration), or analytics buckets move to viewer-local days.
