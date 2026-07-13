import "server-only";

// Nothing client-side ever needs these (the beacon only sends raw path/postId
// — see src/components/view-beacon.tsx), so unlike src/lib/shared/datetime.ts
// this stays server-only.

import { createHash } from "node:crypto";

// Rotates daily (UTC calendar date) so a visitor's hash can't be correlated
// across days — raw IP/user-agent are never stored (design §5.6, §8).
export function dailySalt(seed: string, now: Date): string {
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  return createHash("sha256").update(`${seed}:${day}`).digest("hex");
}

export function computeVisitorHash(
  seed: string,
  ip: string,
  userAgent: string,
  now: Date,
): string {
  const salt = dailySalt(seed, now);
  return createHash("sha256")
    .update(`${salt}:${ip}:${userAgent}`)
    .digest("hex");
}
