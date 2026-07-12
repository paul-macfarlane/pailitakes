import "server-only";

// Auto-ban repeat moderation offenders (CMT-10, ADR-0022): a user who racks
// up too many rejected comments within a trailing window loses comment (and,
// by the same account-level bannedAt flag, like) privileges automatically —
// same enforcement point as an admin-issued ban. The count is LIVE
// (countRejectedCommentsByAuthorSince re-counts currently-`rejected` rows on
// every call), so restoring one of the offending comments un-counts a false
// positive without any separate reconciliation step. Fire-and-forget in
// SEMANTICS, not scheduling: the two `rejected`-landing call sites
// (create.ts) await it — a detached promise could be killed by serverless
// teardown before the ban commits — but it must never throw and never alter
// the caller's rejected-comment result; a failure here (or the
// last-active-admin invariant refusing the ban) is swallowed and logged, not
// surfaced to the commenter.

import { countRejectedCommentsByAuthorSince } from "@/lib/comments/data";
import { env } from "@/lib/shared/env";
import { setUserBannedService } from "@/lib/users/service";

export async function maybeAutoBanForRejectedComment(
  authorId: string,
  now: Date,
): Promise<void> {
  try {
    const since = new Date(
      now.getTime() - env.COMMENT_AUTOBAN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const count = await countRejectedCommentsByAuthorSince(authorId, since);
    if (count < env.COMMENT_AUTOBAN_REJECTED_THRESHOLD) {
      return;
    }

    const result = await setUserBannedService(authorId, true);
    if (result.ok) {
      console.info("auto-ban: rejected-comment threshold reached", {
        authorId,
        count,
        threshold: env.COMMENT_AUTOBAN_REJECTED_THRESHOLD,
        windowDays: env.COMMENT_AUTOBAN_WINDOW_DAYS,
      });
    } else {
      // e.g. the last-active-admin invariant refusing the ban — never a
      // reason to fail the commenter's own rejected-comment result.
      console.warn("auto-ban: ban refused", {
        authorId,
        count,
        threshold: env.COMMENT_AUTOBAN_REJECTED_THRESHOLD,
        reason: result.error,
      });
    }
  } catch (err) {
    console.error("auto-ban: failed", { authorId, err });
  }
}
