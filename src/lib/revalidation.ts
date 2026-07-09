import "server-only";

import { and, gt, inArray, lte, or, sql } from "drizzle-orm";

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
