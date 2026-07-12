// Client-safe domain result for createComment/editOwnComment (design D3) —
// NOT the shared ActionResult<T> (src/lib/shared/action-result.ts): a
// comment submission has more outcomes than ok/error (published immediately,
// held for review, rejected, or explicitly denied with a typed reason), and
// the UI needs to branch on all of them.

import type { CommentDenialReason } from "@/lib/comments/denial";
import type { CommentNode } from "@/lib/comments/tree";

export type CommentSubmitResult =
  // Published immediately (moderation allowed it) — the full node so the UI
  // can insert it into the cache without refetching the whole thread.
  | { status: "visible"; comment: CommentNode }
  // Moderation call itself failed/timed out — fails closed to pending review
  // (design §5.2 step 4).
  | { status: "held"; message: string }
  // Moderation flagged it — final, never published.
  | { status: "denied"; reason: CommentDenialReason; message: string }
  | { status: "rejected"; message: string }
  // Invalid input, not found, ownership, or a generic failure.
  | { status: "error"; message: string };
