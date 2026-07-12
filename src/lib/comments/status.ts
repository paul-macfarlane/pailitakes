// Client-safe comment-status values (no schema/server-only import), mirroring
// src/lib/posts/status.ts's const-object + derived-union style. Keep in sync
// with the `comment_status` pg enum (src/db/schema.ts); a test asserts the
// two match so drift fails CI rather than shipping.

export const CommentStatus = {
  Visible: "visible",
  Held: "held",
  Rejected: "rejected",
  Deleted: "deleted",
} as const;
export type CommentStatus = (typeof CommentStatus)[keyof typeof CommentStatus];

export const COMMENT_STATUSES = [
  CommentStatus.Visible,
  CommentStatus.Held,
  CommentStatus.Rejected,
  CommentStatus.Deleted,
] as const;
