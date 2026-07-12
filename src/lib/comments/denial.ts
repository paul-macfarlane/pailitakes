// Client-safe denial-reason values (no schema/server-only import) for
// createComment (CMT-4): the design requires the action to surface an
// explicit, typeable reason the UI can branch on — a generic error string
// would force the UI to string-match. Mirrors CommentStatus's const-object +
// derived-union shape (src/lib/comments/status.ts).
export const CommentDenialReason = {
  Banned: "banned",
  Archived: "archived",
  Locked: "locked",
  RateLimited: "rate-limited",
} as const;
export type CommentDenialReason =
  (typeof CommentDenialReason)[keyof typeof CommentDenialReason];
