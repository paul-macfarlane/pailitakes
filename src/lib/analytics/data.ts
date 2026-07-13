import "server-only";

// Pure DB access for the analytics domain (page-view ingest) — queries/
// mutations plus error classification only. Business rules (bot filtering,
// disabled-feature posture) live in src/lib/analytics/service/ingest.ts.

import { db } from "@/db";
import { pageViews } from "@/db/schema";

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
