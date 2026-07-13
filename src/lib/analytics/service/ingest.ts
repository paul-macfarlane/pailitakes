import "server-only";

// Business logic for the page-view beacon (design §5.6, ANLY-2). DB access
// lives in src/lib/analytics/data.ts; input validation happens in the thin
// route handler (src/app/api/view/route.ts).

import { isKnownBotUserAgent } from "@/lib/analytics/bot";
import { InsertPageViewResult, insertPageView } from "@/lib/analytics/data";
import { computeVisitorHash } from "@/lib/analytics/visitor-hash";
import { env } from "@/lib/shared/env";

export const PageViewIngestStatus = {
  Recorded: "recorded",
  Dropped: "dropped",
  Disabled: "disabled",
} as const;
export type PageViewIngestStatus =
  (typeof PageViewIngestStatus)[keyof typeof PageViewIngestStatus];

// Public, unauthenticated write by design (§5.6) — no auth check. No rate
// limiting either: not called for in design/backlog for this endpoint.
export async function recordPageView({
  path,
  postId,
  ip,
  userAgent,
}: {
  path: string;
  postId?: string;
  ip: string;
  userAgent: string;
}): Promise<PageViewIngestStatus> {
  // Disabled rather than open when the salt isn't configured, mirroring the
  // CRON_SECRET posture (src/app/api/cron/revalidate/route.ts): a feature
  // that's off is safer than one silently hashing with an empty seed.
  if (!env.ANALYTICS_SALT_SEED) {
    return PageViewIngestStatus.Disabled;
  }

  if (isKnownBotUserAgent(userAgent)) {
    return PageViewIngestStatus.Dropped;
  }

  const visitorHash = computeVisitorHash(
    env.ANALYTICS_SALT_SEED,
    ip,
    userAgent,
    new Date(),
  );

  const result = await insertPageView({
    postId: postId ?? null,
    path,
    visitorHash,
  });

  // A cached post page can beacon the id of a post hard-deleted after
  // caching (design §3 ISR) — not an error, just an unrecordable view.
  if (result === InsertPageViewResult.UnknownPost) {
    return PageViewIngestStatus.Dropped;
  }

  return PageViewIngestStatus.Recorded;
}
