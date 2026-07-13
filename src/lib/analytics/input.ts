// Client-safe analytics dashboard input (no "server-only"/schema import) —
// the admin analytics client island (ANLY-5) needs these const objects for
// its range/granularity <Select>s, mirroring how src/lib/auth/roles.ts stays
// import-safe for src/app/admin/users/_components/user-management-controls.tsx.
// The data layer (src/lib/analytics/data.ts) and service
// (src/lib/analytics/service/aggregates.ts) consume the same types so the
// query-param contract has one source of truth (design §5.6).

import { z } from "zod";

export const AnalyticsRange = {
  Week: "7d",
  Month: "30d",
  Quarter: "90d",
  All: "all",
} as const;
export type AnalyticsRange =
  (typeof AnalyticsRange)[keyof typeof AnalyticsRange];

export const ANALYTICS_RANGES = [
  AnalyticsRange.Week,
  AnalyticsRange.Month,
  AnalyticsRange.Quarter,
  AnalyticsRange.All,
] as const;

export const AnalyticsGranularity = {
  Day: "day",
  Week: "week",
  Month: "month",
} as const;
export type AnalyticsGranularity =
  (typeof AnalyticsGranularity)[keyof typeof AnalyticsGranularity];

export const ANALYTICS_GRANULARITIES = [
  AnalyticsGranularity.Day,
  AnalyticsGranularity.Week,
  AnalyticsGranularity.Month,
] as const;

// Dashboard query params (GET /api/admin/analytics). `granularity` is
// optional — omitted, it's derived from `range` by defaultGranularityForRange
// below, shared by the service (default) and the dashboard (its Select's
// displayed default). Both fields degrade via `.catch` rather than 400: an
// admin-only *filter* param, not a public route param (engineering rule).
export const analyticsQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).catch(AnalyticsRange.Month),
  granularity: z.enum(ANALYTICS_GRANULARITIES).optional().catch(undefined),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// 7d/30d bucket by day (few enough buckets to stay readable), 90d steps up to
// week, and "all" (potentially years of data) buckets by month.
const DEFAULT_GRANULARITY: Record<AnalyticsRange, AnalyticsGranularity> = {
  [AnalyticsRange.Week]: AnalyticsGranularity.Day,
  [AnalyticsRange.Month]: AnalyticsGranularity.Day,
  [AnalyticsRange.Quarter]: AnalyticsGranularity.Week,
  [AnalyticsRange.All]: AnalyticsGranularity.Month,
};

export function defaultGranularityForRange(
  range: AnalyticsRange,
): AnalyticsGranularity {
  return DEFAULT_GRANULARITY[range];
}

const RANGE_DAYS: Record<
  Exclude<AnalyticsRange, typeof AnalyticsRange.All>,
  number
> = {
  [AnalyticsRange.Week]: 7,
  [AnalyticsRange.Month]: 30,
  [AnalyticsRange.Quarter]: 90,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// null = no lower bound ("all time"). `now` is caller-supplied (not `new
// Date()` internally) so callers — and their tests — can pin a fixed instant.
export function rangeSince(range: AnalyticsRange, now: Date): Date | null {
  if (range === AnalyticsRange.All) return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY);
}
