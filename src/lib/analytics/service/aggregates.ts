import "server-only";

// Admin analytics dashboard aggregates (design §5.6, ANLY-4/5). DB access
// lives in src/lib/analytics/data.ts; input validation happens in the thin
// route handler (src/app/api/admin/analytics/route.ts).

import {
  countViewsByBucket,
  countViewsByCategory,
  viewsAndEngagementByPost,
  type CategoryViews,
  type PostEngagement,
  type ViewBucket,
} from "@/lib/analytics/data";
import {
  defaultGranularityForRange,
  rangeSince,
  type AnalyticsGranularity,
  type AnalyticsRange,
} from "@/lib/analytics/input";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

// Loose shape (mirrors LikeActor, src/lib/likes/service.ts): Better Auth's
// session.user types role as a plain string, and this service has no reason
// to couple to the full Session type.
export type AnalyticsViewer = {
  role?: string | null;
  bannedAt?: Date | null;
};

export type AnalyticsSummary = {
  traffic: ViewBucket[];
  categories: CategoryViews[];
  posts: PostEngagement[];
};

// Caps the per-post query's row count — plenty for the top-10 chart slice
// and a readable full table at this scale (design §5.6: raw rows + indexed
// aggregates are instant, a rollup table is deliberately deferred).
const POST_ENGAGEMENT_LIMIT = 50;

// canPerformAction already folds in the ban check (design §5.7), same gate
// shape as setPostLike/setCommentLike.
export async function getAnalyticsSummary(
  viewer: AnalyticsViewer,
  {
    range,
    granularity,
  }: { range: AnalyticsRange; granularity?: AnalyticsGranularity },
  now: Date = new Date(),
): Promise<ActionResult<AnalyticsSummary>> {
  if (!canPerformAction(viewer, Action.ViewAnalytics)) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const resolvedGranularity = granularity ?? defaultGranularityForRange(range);
  const since = rangeSince(range, now);

  const [traffic, categories, posts] = await Promise.all([
    countViewsByBucket({ granularity: resolvedGranularity, since }),
    countViewsByCategory({ since }),
    viewsAndEngagementByPost({ since, limit: POST_ENGAGEMENT_LIMIT }),
  ]);

  return { ok: true, data: { traffic, categories, posts } };
}
