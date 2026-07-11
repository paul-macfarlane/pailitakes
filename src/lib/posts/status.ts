// Pure post-status state machine (no "server-only"): the transition action in
// src/actions/posts.ts enforces it server-side, and admin UI reuses it to
// decide which buttons to show. FR-1.5 (the four statuses), FR-1.6 (archive is
// recoverable), design §4 (visibility is a query over status + timestamps).

export const PostStatus = {
  Draft: "draft",
  Scheduled: "scheduled",
  Published: "published",
  Archived: "archived",
} as const;
export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus];

// Keep in sync with the `post_status` pg enum (src/db/schema.ts); a test
// asserts the two match so drift fails CI rather than shipping.
export const POST_STATUSES = [
  PostStatus.Draft,
  PostStatus.Scheduled,
  PostStatus.Published,
  PostStatus.Archived,
] as const;

// Statuses that can be publicly visible (subject to the publish/archive
// timestamps). Single source of truth for visiblePostsWhere(), isPublicly-
// Visible(), and the ADM-9 revalidation crossing scan — they must agree.
export const PUBLIC_STATUSES = [
  PostStatus.Published,
  PostStatus.Scheduled,
] as const;

// Manual, immediate transitions an author/admin can trigger. Moving a post
// INTO `scheduled` needs a future publish_at and is ADM-5's schedule action,
// so it's deliberately absent here — this machine only covers status moves
// that need no caller-supplied timestamp.
const ALLOWED_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  draft: ["published", "archived"],
  scheduled: ["published", "draft", "archived"],
  published: ["draft", "archived"],
  // Recoverable: an archived post restores to draft or straight to published
  // (FR-1.6).
  archived: ["draft", "published"],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// Scheduling (ADM-5) sets a FUTURE publish_at/archive_at rather than moving
// status immediately, so it isn't part of ALLOWED_TRANSITIONS. A future
// publish is set on a not-yet-public post (draft or an already-scheduled one
// being rescheduled); a future archive is set on a post that is or will be
// public (published or scheduled). FR-7.5, FR-7.6.
export function canSchedulePublish(from: PostStatus): boolean {
  return from === "draft" || from === "scheduled";
}

export function canScheduleArchive(from: PostStatus): boolean {
  return from === "published" || from === "scheduled";
}

// JS mirror of visiblePostsWhere() (src/lib/posts.ts): a post is publicly
// visible iff it's published/scheduled, its publish time has arrived, and its
// archive time hasn't. Keep in sync with the SQL predicate. Used where the UI
// must reflect real visibility rather than the raw status label (the ADM-7
// preview banner) — a scheduled post past its publish_at is live even though
// its status is still "scheduled" until the cron normalizes it.
export function isPubliclyVisible(
  post: {
    status: PostStatus;
    publishAt: Date | null;
    archiveAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  return (
    (PUBLIC_STATUSES as readonly PostStatus[]).includes(post.status) &&
    post.publishAt !== null &&
    post.publishAt <= now &&
    (post.archiveAt === null || post.archiveAt > now)
  );
}

export function allowedTransitions(from: PostStatus): PostStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

// Whether edits to a post in this status are STAGED as pending changes rather
// than written straight to the live columns (draft-of-published, ADR-0011).
// True for the public-track statuses: the public already sees this content (or
// will see it unchanged at a scheduled time), so an edit must not reach the
// live post until the author explicitly publishes it. Draft/archived posts are
// not public, so their edits write through immediately.
export function usesDraftBuffer(status: PostStatus): boolean {
  return (PUBLIC_STATUSES as readonly PostStatus[]).includes(status);
}

// Human labels for the current status (badge) and for a transition button
// keyed by its TARGET status.
export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export const TRANSITION_LABELS: Record<PostStatus, string> = {
  draft: "Move to draft",
  scheduled: "Schedule",
  published: "Publish now",
  archived: "Archive",
};
