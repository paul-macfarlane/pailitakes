import { createHash, timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { IMMEDIATE } from "@/lib/cache";
import { env } from "@/lib/env";
import {
  advanceRevalidationMarker,
  getCrossedSlugs,
} from "@/lib/revalidation";

// Constant-time compare (hash to a fixed length first so length never leaks):
// the bearer token is a shared secret, so avoid a timing side channel.
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ADM-9 revalidation cron (cron-job.org hits this ~every 5 min). Bearer-authed
// with CRON_SECRET; idempotent and DB-tracked (see src/lib/revalidation.ts).
// Makes scheduled publish/archive crossings cache-exact between the 60s ISR
// windows. Reading the Authorization header keeps this handler dynamic.
export async function GET(request: Request) {
  // Disabled rather than open when the secret isn't configured.
  if (!env.CRON_SECRET) {
    return Response.json({ error: "Cron not configured." }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!tokenMatches(auth, `Bearer ${env.CRON_SECRET}`)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const slugs = await getCrossedSlugs(now);

  // Revalidate BEFORE advancing the marker: a crash here reprocesses the same
  // window next run (revalidateTag is idempotent) rather than silently
  // dropping these crossings.
  for (const slug of slugs) {
    revalidateTag(`post:${slug}`, IMMEDIATE);
  }
  if (slugs.length > 0) {
    // Home, category/tag listings, and the sitemap all share this tag (§3).
    revalidateTag("post-list", IMMEDIATE);
  }

  await advanceRevalidationMarker(now);

  return Response.json({ revalidated: slugs.length, ranAt: now.toISOString() });
}
