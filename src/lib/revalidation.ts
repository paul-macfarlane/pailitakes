import "server-only";

import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { posts, revalidationState } from "@/db/schema";
import { PUBLIC_STATUSES } from "@/lib/post-status";

// Distinct slugs of posts whose publish_at or archive_at crossed since the
// cron's last run — i.e. posts that just became visible or hidden (design §4).
// The window (lastRun, now] is read from the DB, not from call timing, so a
// missed or duplicated trigger is harmless. READ-ONLY: the marker is advanced
// separately, AFTER the caller has revalidated, so a crash mid-revalidation
// reprocesses the window next run (at-least-once) rather than dropping it.
// Only scheduled/published posts count — a timestamp on a draft/archived post
// can't change public visibility.
export async function getCrossedSlugs(now: Date): Promise<string[]> {
  const [state] = await db
    .select({ lastRunAt: revalidationState.lastRunAt })
    .from(revalidationState)
    .limit(1);

  // Absent row (fresh install before the seed, or a manual reset): no window
  // to process — the 60s ISR is the safety net until the marker exists.
  const lastRun = state?.lastRunAt ?? now;
  if (lastRun >= now) return [];

  const crossed = await db
    .select({ slug: posts.slug })
    .from(posts)
    .where(
      and(
        inArray(posts.status, [...PUBLIC_STATUSES]),
        or(
          and(gt(posts.publishAt, lastRun), lte(posts.publishAt, now)),
          and(gt(posts.archiveAt, lastRun), lte(posts.archiveAt, now)),
        ),
      ),
    );

  return [...new Set(crossed.map((row) => row.slug))];
}

// Normalizes stored post statuses to match reality (design §4): visibility is a
// query predicate (visiblePostsWhere), so a scheduled post goes public the
// instant its publish_at passes even though its stored status is still
// 'scheduled' — leaving the admin badge stale. The cron catches the status up:
// scheduled -> published once publish_at has passed, and published/scheduled ->
// archived once archive_at has passed. Self-healing and idempotent: it targets
// every currently-stale row (not just the last window), so a missed run simply
// corrects on the next one.
// Returns how many rows it normalized — reported separately from the cron's
// cache-revalidation count (they measure different things: this is status
// bookkeeping, not cache invalidation).
export async function normalizePostStatuses(now: Date): Promise<number> {
  // Publish first: a scheduled post past its publish time is live.
  const published = await db
    .update(posts)
    .set({ status: "published" })
    .where(and(eq(posts.status, "scheduled"), lte(posts.publishAt, now)))
    .returning({ id: posts.id });

  // Then archive: a public post past its archive time is hidden. Clear any
  // staged draft (ADR-0011) so a pending snapshot isn't stranded on a post that
  // just left the public set with no UI to resolve it.
  const archived = await db
    .update(posts)
    .set({ status: "archived", draft: null, draftUpdatedAt: null })
    .where(
      and(
        inArray(posts.status, ["scheduled", "published"]),
        lte(posts.archiveAt, now),
      ),
    )
    .returning({ id: posts.id });

  return published.length + archived.length;
}

// Advances the cron's last-run marker to `now`, monotonically: an out-of-order
// or concurrent run can never move it backward (which would reprocess an
// already-handled window). Call AFTER revalidation succeeds.
export async function advanceRevalidationMarker(now: Date): Promise<void> {
  await db
    .insert(revalidationState)
    .values({ id: true, lastRunAt: now })
    .onConflictDoUpdate({
      target: revalidationState.id,
      set: {
        lastRunAt: sql`greatest(${revalidationState.lastRunAt}, ${now})`,
      },
    });
}
