"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { QueryProvider } from "@/components/query-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ANALYTICS_GRANULARITIES,
  ANALYTICS_RANGES,
  AnalyticsGranularity,
  AnalyticsRange,
  defaultGranularityForRange,
} from "@/lib/analytics/input";

// Wire shape of GET /api/admin/analytics (src/app/api/admin/analytics/
// route.ts). Declared locally rather than imported from
// src/lib/analytics/service/aggregates.ts: that module carries a
// `server-only` import, and this is a client component — mirrors
// CommentThreadResponse in comments-section.tsx.
type TrafficBucket = { bucket: string; views: number; uniques: number };
type CategoryViews = { categoryId: number; name: string; views: number };
type PostEngagement = {
  postId: string;
  title: string;
  slug: string;
  views: number;
  comments: number;
  likes: number;
};
type AnalyticsSummaryResponse = {
  traffic: TrafficBucket[];
  categories: CategoryViews[];
  posts: PostEngagement[];
};

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  [AnalyticsRange.Week]: "Last 7 days",
  [AnalyticsRange.Month]: "Last 30 days",
  [AnalyticsRange.Quarter]: "Last 90 days",
  [AnalyticsRange.All]: "All time",
};

const GRANULARITY_LABELS: Record<AnalyticsGranularity, string> = {
  [AnalyticsGranularity.Day]: "Daily",
  [AnalyticsGranularity.Week]: "Weekly",
  [AnalyticsGranularity.Month]: "Monthly",
};

// UTC-pinned, mirroring src/app/admin/page.tsx's dateFormat: bucket strings
// are UTC calendar dates (src/lib/analytics/data.ts), so the tick label must
// render in UTC too or it'd disagree with the bucket boundary on some
// viewers' clocks.
const axisDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatBucketTick(bucket: string): string {
  return axisDateFormat.format(new Date(`${bucket}T00:00:00Z`));
}

// ChartTooltipContent's labelFormatter is typed against ReactNode (it also
// serves non-string labels elsewhere) — the traffic chart's label is always
// the bucket string produced by countViewsByBucket, so narrow it here rather
// than loosening formatBucketTick's signature for every other caller.
function formatTooltipLabel(label: React.ReactNode): React.ReactNode {
  return typeof label === "string" ? formatBucketTick(label) : label;
}

const TITLE_TICK_MAX = 24;
function truncateTitle(title: string): string {
  return title.length > TITLE_TICK_MAX
    ? `${title.slice(0, TITLE_TICK_MAX - 1)}…`
    : title;
}

async function fetchAnalytics(
  range: AnalyticsRange,
  granularity: AnalyticsGranularity,
): Promise<AnalyticsSummaryResponse> {
  const params = new URLSearchParams({ range, granularity });
  const response = await fetch(`/api/admin/analytics?${params}`, {
    // Deliberately uncached (design §3/§5.6) — TanStack Query owns
    // freshness for this island, not the HTTP cache.
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load analytics.");
  }
  return response.json();
}

// Island root (design §3, ANLY-5): the range/granularity controls need
// client-side refetching against the uncached /api/admin/analytics route, so
// this mounts its own QueryProvider (same pattern as CommentsSection).
export function AnalyticsDashboard() {
  return (
    <QueryProvider>
      <AnalyticsDashboardInner />
    </QueryProvider>
  );
}

function AnalyticsDashboardInner() {
  const [range, setRange] = useState<AnalyticsRange>(AnalyticsRange.Month);
  // null = "follow the range's derived default" — cleared on every range
  // change so switching ranges doesn't strand a stale explicit choice (e.g.
  // picking Weekly on 90d, then dropping to 7d, would otherwise silently
  // keep Weekly instead of re-deriving Daily).
  const [granularityOverride, setGranularityOverride] =
    useState<AnalyticsGranularity | null>(null);
  const granularity = granularityOverride ?? defaultGranularityForRange(range);

  const rangeSelectId = useId();
  const granularitySelectId = useId();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics", range, granularity],
    queryFn: () => fetchAnalytics(range, granularity),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <Label
          htmlFor={rangeSelectId}
          className="flex flex-col items-start gap-1 text-sm font-normal"
        >
          <span className="text-muted-foreground">Date range</span>
          <Select
            value={range}
            onValueChange={(value) => {
              setRange(value as AnalyticsRange);
              setGranularityOverride(null);
            }}
          >
            <SelectTrigger id={rangeSelectId} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANALYTICS_RANGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {RANGE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>

        <Label
          htmlFor={granularitySelectId}
          className="flex flex-col items-start gap-1 text-sm font-normal"
        >
          <span className="text-muted-foreground">Bucket by</span>
          <Select
            value={granularity}
            onValueChange={(value) =>
              setGranularityOverride(value as AnalyticsGranularity)
            }
          >
            <SelectTrigger id={granularitySelectId} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANALYTICS_GRANULARITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {GRANULARITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError || !data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border p-6 text-sm text-destructive"
        >
          <p>Couldn&rsquo;t load analytics.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          <TrafficCard traffic={data.traffic} />
          <div className="grid gap-6 lg:grid-cols-2">
            <TopPostsCard posts={data.posts} />
            <CategoryCard categories={data.categories} />
          </div>
          <PostsTableCard posts={data.posts} />
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-80 w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function EmptyState() {
  return (
    <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
      No views in this range yet.
    </p>
  );
}

const trafficChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
  uniques: { label: "Unique visitors", color: "var(--chart-2)" },
} satisfies ChartConfig;

// This exact pair (chart-1/chart-2) is the a11y-validated combination for a
// two-series chart in both light and dark mode — no other chart-N pair is
// validated for this purpose (§6 dataviz rules).
function TrafficCard({ traffic }: { traffic: TrafficBucket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic over time</CardTitle>
      </CardHeader>
      <CardContent>
        {traffic.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer config={trafficChartConfig} className="h-72 w-full">
            <AreaChart data={traffic} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatBucketTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip
                content={
                  <ChartTooltipContent labelFormatter={formatTooltipLabel} />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="views"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="uniques"
                stroke="var(--chart-2)"
                fill="var(--chart-2)"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const topPostsChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

function TopPostsCard({ posts }: { posts: PostEngagement[] }) {
  // Server already orders by views desc; slice to the top 10 for the chart
  // (the full set still renders in PostsTableCard below).
  const topPosts = posts.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top posts</CardTitle>
      </CardHeader>
      <CardContent>
        {topPosts.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer config={topPostsChartConfig} className="h-72 w-full">
            <BarChart
              data={topPosts}
              layout="vertical"
              margin={{ left: 4, right: 12, top: 8 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="title"
                tickFormatter={truncateTitle}
                width={140}
                interval={0}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
              <Bar
                dataKey="views"
                fill="var(--chart-1)"
                radius={[0, 4, 4, 0]}
                barSize={16}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const categoryChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

function CategoryCard({ categories }: { categories: CategoryViews[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Views by category</CardTitle>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer config={categoryChartConfig} className="h-72 w-full">
            <BarChart data={categories} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
              <Bar
                dataKey="views"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

// Doubles as the accessible table-view fallback for the two charts above
// (both draw from the same `posts` data) — FR-8.3 per-post views plus
// engagement (comments/likes).
function PostsTableCard({ posts }: { posts: PostEngagement[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Posts</CardTitle>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Post
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Views
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Comments
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Likes
                  </th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.postId} className="border-b last:border-0">
                    <td className="max-w-xs py-2 pr-4">
                      <Link
                        href={`/posts/${post.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate hover:underline"
                      >
                        {post.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {post.views.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {post.comments.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {post.likes.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
