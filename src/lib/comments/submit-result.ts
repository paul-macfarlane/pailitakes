// Client-safe domain result for createComment/editOwnComment (design D3) —
// NOT the shared ActionResult<T> (src/lib/shared/action-result.ts): a
// comment submission has more outcomes than ok/error (published immediately,
// held for review, rejected, or explicitly denied with a typed reason), and
// the UI needs to branch on all of them.

import type { CommentDenialReason } from "@/lib/comments/denial";
import type { CommentNode } from "@/lib/comments/tree";

// Mirrors CommentStatus's const-object + derived-union style
// (src/lib/comments/status.ts), extended with the two outcomes that only
// apply to a submission attempt (denied, error) rather than a stored row.
export const CommentSubmitStatus = {
  Visible: "visible",
  Held: "held",
  Rejected: "rejected",
  Denied: "denied",
  Error: "error",
} as const;
export type CommentSubmitStatus =
  (typeof CommentSubmitStatus)[keyof typeof CommentSubmitStatus];

export type CommentSubmitResult =
  // Published immediately (moderation allowed it) — the full node so the UI
  // can insert it into the cache without refetching the whole thread.
  | { status: typeof CommentSubmitStatus.Visible; comment: CommentNode }
  // Moderation call itself failed/timed out — fails closed to pending review
  // (design §5.2 step 4).
  | { status: typeof CommentSubmitStatus.Held; message: string }
  // Moderation flagged it — final, never published.
  | {
      status: typeof CommentSubmitStatus.Denied;
      reason: CommentDenialReason;
      message: string;
    }
  | { status: typeof CommentSubmitStatus.Rejected; message: string }
  // Invalid input, not found, ownership, or a generic failure.
  | { status: typeof CommentSubmitStatus.Error; message: string };
