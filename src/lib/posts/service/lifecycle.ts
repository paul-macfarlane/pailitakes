import "server-only";

// Business logic for the post lifecycle actions (ADM-4/ADM-5): immediate
// status transitions and scheduled publish/archive. DB access lives in
// src/lib/posts/data.ts; auth/ownership guarding happens in the thin action
// (src/actions/posts/lifecycle.ts) before these are called.

import { revalidateTag } from "next/cache";

import type { StaffSession } from "@/lib/auth/guards";
import {
  casCancelScheduledArchive,
  casScheduleArchive,
  casSchedulePublish,
  casTransitionStatus,
  loadOwnedLifecycle,
  type PostColumnUpdate,
} from "@/lib/posts/data";
import { isRenderableImageSrc } from "@/lib/content/image-src";
import {
  canScheduleArchive,
  canSchedulePublish,
  canTransition,
  type PostStatus,
} from "@/lib/posts/status";
import { CONFLICT_ERROR, GENERIC_ERROR } from "@/lib/posts/service/shared";
import { IMMEDIATE } from "@/lib/shared/cache";
import type { ActionResult } from "@/lib/shared/action-result";

// A public post with staged edits (posts.draft) must have them promoted or
// discarded before any lifecycle change — keeps the buffer from being
// stranded on a post that leaves the published/scheduled set (ADR-0011).
const PENDING_CHANGES_ERROR = "Publish or discard your pending changes first.";

// Move a post between statuses (draft/scheduled/published/archived). The
// allowed moves live in the pure state machine (src/lib/posts/status.ts);
// this service adds the publish-time thumbnail gate and the timestamp
// side-effects. Scheduling a FUTURE publish_at/archive_at is a separate
// service (schedulePublishService/scheduleArchiveService) — this only does
// immediate moves.
export async function transitionPostStatusService(
  id: string,
  target: PostStatus,
  session: StaffSession,
): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const existing = loaded.post;

    // A public post with unpublished staged edits must resolve them before any
    // status move, so the buffer is never stranded on a post that has left the
    // published/scheduled set (ADR-0011).
    if (existing.hasDraft) {
      return { ok: false, error: PENDING_CHANGES_ERROR };
    }

    // `scheduled` is never an immediate transition target — it needs a future
    // publish_at (schedulePublish). Reject it after the ownership/not-found
    // check (so a non-owner still gets the authz result) but before the
    // idempotent-no-op below, which would otherwise return ok for an
    // already-scheduled post.
    if (target === "scheduled") {
      return {
        ok: false,
        error: "Use schedule publish to set a publish time.",
      };
    }

    // Idempotent: asking for the status a post already has is a success with
    // no write and no cache churn (a double-clicked button shouldn't error).
    if (existing.status === target) {
      return { ok: true, data: { id, status: target } };
    }

    if (!canTransition(existing.status, target)) {
      return {
        ok: false,
        error: `Cannot move a ${existing.status} post to ${target}.`,
      };
    }

    // Publish-time validation: a published post's card and hero need a real
    // image, so "" (the draft placeholder from ADM-3) can't go public. The
    // thumbnail field itself arrives in ADM-6; until then editor-created
    // posts must have a thumbnail set before they can be published.
    if (
      target === "published" &&
      !isRenderableImageSrc(existing.thumbnailUrl)
    ) {
      return {
        ok: false,
        error: "Add a thumbnail image before publishing.",
      };
    }

    const now = new Date();
    const updates: PostColumnUpdate = { status: target };
    if (target === "published") {
      // Restoring an archived post that was genuinely published before keeps
      // its original date and feed position (FR-1.6). Every other path is a
      // real "publish now" and stamps now() — including publish->draft->
      // publish, where a stale past publish_at lingers on the draft and must
      // NOT be treated as the original (that would backdate the republish).
      // Key on the source status, not just the timestamp.
      const restoringPublished =
        existing.status === "archived" &&
        existing.publishAt !== null &&
        existing.publishAt <= now;
      updates.publishAt = restoringPublished ? existing.publishAt : now;
      // Clear any pending/expired archive so the post doesn't immediately
      // re-hide.
      updates.archiveAt = null;
    } else {
      // Leaving the published/scheduled set — drop any scheduled archive so
      // a hidden post never carries a pending auto-archive that the cron
      // would later revalidate for nothing.
      updates.archiveAt = null;
    }

    if (!(await casTransitionStatus(id, existing.status, updates))) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${existing.slug}`, IMMEDIATE);

    return { ok: true, data: { id, status: target } };
  } catch (err) {
    console.error("transitionPostStatus failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Schedule a future publish (FR-7.5): sets status='scheduled' with a future
// publish_at. Visibility is automatic — visiblePostsWhere() includes
// 'scheduled' rows once publish_at <= now (design §4), so the post appears at
// that instant with no job; the ADM-9 cron only makes cache invalidation
// exact. Rescheduling an already-scheduled post is allowed.
export async function schedulePublishService(
  id: string,
  publishAt: Date,
  session: StaffSession,
): Promise<ActionResult<{ id: string; publishAt: string }>> {
  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

    if (post.hasDraft) {
      return { ok: false, error: PENDING_CHANGES_ERROR };
    }
    if (!canSchedulePublish(post.status)) {
      return {
        ok: false,
        error: `Cannot schedule a ${post.status} post to publish.`,
      };
    }
    const now = new Date();
    // A 'scheduled' post whose publish_at has already passed is LIVE
    // (visiblePostsWhere shows scheduled + publish_at <= now, §4) even though
    // the cron hasn't flipped its status yet. Rescheduling it to the future
    // would silently retract a public post — treat it as published: archive
    // it first to take it down.
    if (
      post.status === "scheduled" &&
      post.publishAt !== null &&
      post.publishAt <= now
    ) {
      return {
        ok: false,
        error: "This post is already live. Archive it before rescheduling.",
      };
    }
    if (publishAt <= now) {
      return { ok: false, error: "Publish time must be in the future." };
    }
    // A scheduled post will go public — same thumbnail gate as publishing now.
    if (!isRenderableImageSrc(post.thumbnailUrl)) {
      return {
        ok: false,
        error: "Add a thumbnail image before scheduling a publish.",
      };
    }
    // A pending scheduled archive must stay after the new publish time.
    if (post.archiveAt !== null && post.archiveAt <= publishAt) {
      return {
        ok: false,
        error:
          "The scheduled archive is before this publish time. Change or cancel it first.",
      };
    }

    // CAS also guards archive_at unchanged (so a concurrent scheduleArchive
    // can't slip a nearer archive_at past the check above, leaving publish_at
    // >= archive_at) and `draft is null` (so a concurrent first-stage edit
    // can't strand a buffer on the post — ADR-0011).
    if (
      !(await casSchedulePublish(id, post.status, publishAt, post.archiveAt))
    ) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${post.slug}`, IMMEDIATE);

    return { ok: true, data: { id, publishAt: publishAt.toISOString() } };
  } catch (err) {
    console.error("schedulePublish failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Schedule a future archive (FR-7.6): sets archive_at on a published or
// scheduled post; status is untouched. Once archive_at <= now the post drops
// out of visiblePostsWhere() automatically (design §4).
export async function scheduleArchiveService(
  id: string,
  archiveAt: Date,
  session: StaffSession,
): Promise<ActionResult<{ id: string; archiveAt: string }>> {
  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

    if (post.hasDraft) {
      return { ok: false, error: PENDING_CHANGES_ERROR };
    }
    if (!canScheduleArchive(post.status)) {
      return {
        ok: false,
        error: `Cannot schedule an archive for a ${post.status} post.`,
      };
    }
    if (archiveAt <= new Date()) {
      return { ok: false, error: "Archive time must be in the future." };
    }
    // Can't archive before the post is even published.
    if (post.publishAt !== null && archiveAt <= post.publishAt) {
      return {
        ok: false,
        error: "Archive time must be after the publish time.",
      };
    }

    // CAS guards publish_at unchanged (mirror of schedulePublish, so a
    // concurrent reschedule can't move publish_at past this archive time) and
    // `draft is null` (so a concurrent first-stage edit can't strand a buffer
    // on the post — ADR-0011).
    if (
      !(await casScheduleArchive(id, post.status, archiveAt, post.publishAt))
    ) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${post.slug}`, IMMEDIATE);

    return { ok: true, data: { id, archiveAt: archiveAt.toISOString() } };
  } catch (err) {
    console.error("scheduleArchive failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Cancels a pending scheduled archive (clears archive_at) without changing
// status. Idempotent when there's nothing scheduled.
export async function cancelScheduledArchiveService(
  id: string,
  session: StaffSession,
): Promise<ActionResult<{ id: string }>> {
  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

    // Nothing scheduled — succeed without a write or cache churn.
    if (post.archiveAt === null) {
      return { ok: true, data: { id } };
    }

    if (!(await casCancelScheduledArchive(id, post.status))) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${post.slug}`, IMMEDIATE);

    return { ok: true, data: { id } };
  } catch (err) {
    console.error("cancelScheduledArchive failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
