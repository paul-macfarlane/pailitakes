import "server-only";

// Pure DB access for the analytics domain (page-view ingest + dashboard
// aggregates) — queries/mutations plus error classification only. Business
// rules (bot filtering, disabled-feature posture, dashboard authorization)
// live in src/lib/analytics/service/*.ts.

import { desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, comments, pageViews, postLikes, posts } from "@/db/schema";
import type { AnalyticsGranularity } from "@/lib/analytics/input";
import { CommentStatus } from "@/lib/comments/status";

export const InsertPageViewResult = {
  Inserted: "inserted",
  UnknownPost: "unknown-post",
} as const;
export type InsertPageViewResult =
  (typeof InsertPageViewResult)[keyof typeof InsertPageViewResult];

// Mirrors uniqueViolationConstraint (src/lib/posts/data.ts) / the FK variant
// in src/lib/comments/data.ts: node-postgres surfaces the Postgres error code
// as `.code` on the thrown error; drizzle's node-postgres driver rethrows it
// as-is, but walk `.cause` too in case a wrapper is ever introduced between
// here and the driver.
function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23503") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== err
    ? isForeignKeyViolation(cause)
    : false;
}

// A cached post page (ISR, design §3) can beacon the id of a post that was
// hard-deleted after the page was cached — the FK violation this produces is
// an expected, non-error outcome (UnknownPost), not a bug to surface.
//
// Why insert-and-classify rather than upsert: ON CONFLICT can't help here —
// Postgres upsert handles only unique/exclusion constraint conflicts, not FK
// violations, and page_views is append-only with no conflict key — every
// pageview is a new row. Catching 23503 keeps it a single atomic statement
// (no check-then-act round trip).
export async function insertPageView({
  postId,
  path,
  visitorHash,
}: {
  postId: string | null;
  path: string;
  visitorHash: string;
}): Promise<InsertPageViewResult> {
  try {
    await db.insert(pageViews).values({ postId, path, visitorHash });
    return InsertPageViewResult.Inserted;
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return InsertPageViewResult.UnknownPost;
    }
    throw err;
  }
}

export type ViewBucket = { bucket: string; views: number; uniques: number };

// date_trunc's granularity argument is inlined as a raw SQL literal, not a
// bound `sql` parameter, and validated against this closed set first
// (defense in depth — the type already restricts callers to
// AnalyticsGranularity, but a raw string is never interpolated unchecked).
// Reason: Postgres's GROUP BY/ORDER BY functional-dependency check requires
// the exact same expression at every use site, but Drizzle's `sql` tag mints
// a fresh bind parameter ($1, $2, $3...) each time a fragment is rendered
// into select/groupBy/orderBy — three value-identical but syntactically
// distinct parameters make Postgres treat them as different expressions and
// reject the query ("column must appear in the GROUP BY clause"). A raw
// literal has no parameter, so all three occurrences render identical SQL
// text and Postgres recognizes them as the same grouping expression.
// Pre-quoted (date_trunc's first argument is a text literal, not an
// identifier).
const GRANULARITY_SQL: Record<AnalyticsGranularity, string> = {
  day: "'day'",
  week: "'week'",
  month: "'month'",
};

// Traffic over time (design §5.6): count(*) + count(distinct visitor_hash)
// grouped by a UTC calendar bucket. `page_views.created_at` is timestamptz;
// `AT TIME ZONE 'UTC'` converts it to the wall-clock instant in UTC BEFORE
// date_trunc runs, so buckets land on UTC day/week/month boundaries
// regardless of the DB session's timezone setting (date_trunc on a bare
// timestamp truncates using its own value, not the session tz — the AT TIME
// ZONE conversion is what pins it to UTC). `since === null` means no lower
// bound (the "all time" range).
export async function countViewsByBucket({
  granularity,
  since,
}: {
  granularity: AnalyticsGranularity;
  since: Date | null;
}): Promise<ViewBucket[]> {
  const granularitySql = sql.raw(GRANULARITY_SQL[granularity]);
  const bucket = sql<string>`to_char(date_trunc(${granularitySql}, ${pageViews.createdAt} at time zone 'utc'), 'YYYY-MM-DD')`;

  return db
    .select({
      bucket,
      views: sql<number>`count(*)::int`,
      uniques: sql<number>`count(distinct ${pageViews.visitorHash})::int`,
    })
    .from(pageViews)
    .where(since ? gte(pageViews.createdAt, since) : undefined)
    .groupBy(bucket)
    .orderBy(bucket);
}

export type CategoryViews = {
  categoryId: number;
  name: string;
  views: number;
};

// Views by category (design §5.6). Post-centric by construction: the inner
// join to posts (and posts to categories) drops every page_views row with a
// null post_id (home/tags/account/etc.) — those pages have no category, so
// there's nothing to attribute them to.
export async function countViewsByCategory({
  since,
}: {
  since: Date | null;
}): Promise<CategoryViews[]> {
  return db
    .select({
      categoryId: categories.id,
      name: categories.name,
      views: sql<number>`count(*)::int`,
    })
    .from(pageViews)
    .innerJoin(posts, eq(posts.id, pageViews.postId))
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .where(since ? gte(pageViews.createdAt, since) : undefined)
    .groupBy(categories.id, categories.name)
    .orderBy(desc(sql`count(*)`));
}

export type PostEngagement = {
  postId: string;
  title: string;
  slug: string;
  views: number;
  comments: number;
  likes: number;
};

// Per-post views + engagement (design §5.6, FR-8.3): one query, no N+1.
// FROM page_views (inner-joined to posts) already scopes "views" to `since`
// and to posts that had at least one view in the window; the comments/likes
// counts are correlated scalar subqueries (not further joins, which would
// fan out the page_views group and inflate the aggregate) each re-applying
// the SAME `since` bound on their own created_at — a range-scoped dashboard
// should compare like with like ("engagement in this range", not "ever").
// Serves both the top-posts chart (client slices the first N) and the full
// per-post table.
export async function viewsAndEngagementByPost({
  since,
  limit,
}: {
  since: Date | null;
  limit: number;
}): Promise<PostEngagement[]> {
  const commentsWindow = since
    ? sql`and ${comments.createdAt} >= ${since}`
    : sql``;
  const likesWindow = since
    ? sql`and ${postLikes.createdAt} >= ${since}`
    : sql``;

  const commentsCount = sql<number>`(
    select count(*)::int
    from ${comments}
    where ${comments.postId} = ${posts.id}
      and ${comments.status} = ${CommentStatus.Visible}
      ${commentsWindow}
  )`;
  const likesCount = sql<number>`(
    select count(*)::int
    from ${postLikes}
    where ${postLikes.postId} = ${posts.id}
    ${likesWindow}
  )`;

  return db
    .select({
      postId: posts.id,
      title: posts.title,
      slug: posts.slug,
      // posts.id is the group key (primary key of posts) so selecting
      // title/slug ungrouped is valid — they're functionally dependent on it.
      views: sql<number>`count(${pageViews.id})::int`,
      comments: commentsCount,
      likes: likesCount,
    })
    .from(pageViews)
    .innerJoin(posts, eq(posts.id, pageViews.postId))
    .where(since ? gte(pageViews.createdAt, since) : undefined)
    .groupBy(posts.id)
    .orderBy(desc(sql`count(${pageViews.id})`))
    .limit(limit);
}
