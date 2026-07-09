"use server";

// Server actions are the security boundary (design §8, §9): assume hostile
// input on every call, never trust the client, and re-check session + role
// + ownership per action — middleware/UI gating is convenience only.

import { and, eq, inArray, isNull, notInArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import { db, type Db } from "@/db";
import { categories, posts, postTags, tags } from "@/db/schema";
import { isStaff } from "@/lib/authz";
import { IMMEDIATE } from "@/lib/cache";
import { isRenderableImageSrc } from "@/lib/image-src";
import {
  postInputSchema,
  postUpdateSchema,
  slugifyTitle,
  tagToSlug,
  type PostInput,
} from "@/lib/post-input";
import {
  canScheduleArchive,
  canSchedulePublish,
  canTransition,
  POST_STATUSES,
  type PostStatus,
} from "@/lib/post-status";
import { getSession } from "@/lib/session";

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Thrown inside updatePost's transaction to roll back and surface the
// public-thumbnail invariant when a concurrent publish wins the race.
class ThumbnailInvariantError extends Error {}

// Staff-only gate shared by every action below (authors + admins; §5.7).
// Ownership (author scoped to own rows, admin unscoped) is checked per
// action once the target row is loaded.
async function staffSession() {
  const session = await getSession();
  return session && isStaff(session.user) ? session : null;
}

// node-postgres surfaces Postgres error codes (and the violated constraint
// name) as `.code`/`.constraint` on the thrown error; drizzle's
// node-postgres driver rethrows it as-is, but walk `.cause` too in case a
// wrapper ever gets introduced between here and the driver. Returns the
// constraint name for a unique_violation (23505), null otherwise — callers
// scope their handling by constraint (e.g. only `posts_slug_unique` means
// "That slug is taken."; a post_tags PK collision is a different situation
// entirely and must not be mapped to the same message).
function uniqueViolationConstraint(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") {
    const constraint = (err as { constraint?: unknown }).constraint;
    return typeof constraint === "string" ? constraint : "";
  }
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== err
    ? uniqueViolationConstraint(cause)
    : null;
}

// True iff a thrown error is a unique violation on the posts.slug column.
// Exact constraint match — tags_slug_unique / categories_slug_unique must
// not be misread as a post-slug collision. A 23505 with no constraint name
// (helper returns "") is attributed to the post slug too: it's the only
// unique constraint these actions can hit un-shielded (tag writes use
// onConflictDoNothing), and dropping the actionable "slug is taken" error
// because a driver omitted metadata would be the worse failure.
function isPostSlugCollision(err: unknown): boolean {
  const constraint = uniqueViolationConstraint(err);
  return constraint === "posts_slug_unique" || constraint === "";
}

async function categoryExists(categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return row !== undefined;
}

// Transaction type accepted by `db.transaction(async (tx) => ...)` — both
// the Neon and node-postgres drivers behind `Db` share this shape.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Tag names as typed by the author -> upserted rows attached to the post.
// Normalizes (trim, dedupe by derived slug, drop empties), upserts any new
// tags, then replaces the post's full tag set in one go.
async function setPostTags(
  tx: Tx,
  postId: string,
  tagNames: string[],
): Promise<void> {
  const bySlug = new Map<string, string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const slug = tagToSlug(name);
    // Defense in depth: the tag input schema already rejects unslugifiable
    // names, but skip rather than collapse if one ever slips through.
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, name);
  }

  await tx.delete(postTags).where(eq(postTags.postId, postId));

  if (bySlug.size === 0) return;

  await tx
    .insert(tags)
    .values([...bySlug.entries()].map(([slug, name]) => ({ slug, name })))
    .onConflictDoNothing({ target: tags.slug });

  const tagRows = await tx
    .select({ id: tags.id, slug: tags.slug })
    .from(tags)
    .where(inArray(tags.slug, [...bySlug.keys()]));

  await tx
    .insert(postTags)
    .values(tagRows.map((row) => ({ postId, tagId: row.id })))
    // Makes concurrent same-post tag saves idempotent instead of raising
    // 23505 on the composite (post_id, tag_id) PK.
    .onConflictDoNothing();
}

async function insertPost(
  slug: string,
  data: PostInput,
  authorId: string,
): Promise<{ id: string; slug: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posts)
      .values({
        authorId,
        title: data.title,
        slug,
        bodyMd: data.bodyMd,
        thumbnailUrl: data.thumbnailUrl,
        bannerUrl: data.bannerUrl,
        videoUrl: data.videoUrl,
        categoryId: data.categoryId,
      })
      .returning({ id: posts.id, slug: posts.slug });

    await setPostTags(tx, row!.id, data.tags);

    return row!;
  });
}

export async function createPost(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  // Session/role checked before parsing input: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (or a 100KB body parsed) for input it was never
  // entitled to submit (engineering rules: session -> role -> everything
  // else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const parsed = postInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  const data = parsed.data;

  try {
    if (!(await categoryExists(data.categoryId))) {
      return { ok: false, error: "Unknown category." };
    }

    // An explicit slug is a deliberate author choice — same rule as
    // updatePost — so it's only the title-derived case that gets a
    // disambiguation retry below.
    const derivedSlug = data.slug === undefined;
    const slug = data.slug ?? slugifyTitle(data.title);

    try {
      return { ok: true, data: await insertPost(slug, data, session.user.id) };
    } catch (err) {
      if (!isPostSlugCollision(err)) throw err;

      if (!derivedSlug) {
        return { ok: false, error: "That slug is taken." };
      }

      // Retry once with a disambiguated slug — covers the common case of two
      // drafts sharing a title. Truncate the base to 73 chars (stripping any
      // trailing hyphen left by the cut) so the appended "-" + 6 hex chars
      // never pushes the result past the 80-char cap postUpdateSchema
      // enforces on every later editor round-trip. A second collision
      // (vanishingly unlikely) surfaces as a normal, actionable error
      // instead of retrying forever.
      const retryBase = slug.slice(0, 73).replace(/-+$/, "");
      const retrySlug = `${retryBase}-${crypto.randomUUID().slice(0, 6)}`;
      try {
        return {
          ok: true,
          data: await insertPost(retrySlug, data, session.user.id),
        };
      } catch (retryErr) {
        if (isPostSlugCollision(retryErr)) {
          return { ok: false, error: "That slug is taken." };
        }
        throw retryErr;
      }
    }
  } catch (err) {
    console.error("createPost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function updatePost(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  // Session/role checked before parsing anything: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (engineering rules: session -> role -> everything
  // else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const parsed = postUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  const data = parsed.data;

  try {
    // Two independent reads on the editor's hottest path — issue them
    // concurrently; error precedence (not found -> ownership -> category)
    // is preserved by the check order below.
    const [[existing], categoryOk] = await Promise.all([
      db
        .select({
          authorId: posts.authorId,
          slug: posts.slug,
          status: posts.status,
        })
        .from(posts)
        .where(eq(posts.id, id))
        .limit(1),
      data.categoryId === undefined ? true : categoryExists(data.categoryId),
    ]);

    if (!existing) {
      return { ok: false, error: "Post not found." };
    }

    // Authors are scoped to their own rows; admins are unscoped (§5.7).
    if (
      session.user.role !== "admin" &&
      existing.authorId !== session.user.id
    ) {
      return { ok: false, error: "Not authorized." };
    }

    if (!categoryOk) {
      return { ok: false, error: "Unknown category." };
    }

    // Preserve the "public posts have a thumbnail" invariant that the publish
    // and schedule-publish gates establish: a post that is already public or
    // will become public (published/scheduled) can't have its thumbnail
    // cleared here, which would otherwise reach the live feed as a broken
    // card without ever passing back through a publish-time check. This
    // read-time check blocks the common case; the write below re-guards it
    // under concurrency.
    const clearingThumbnail =
      data.thumbnailUrl !== undefined &&
      !isRenderableImageSrc(data.thumbnailUrl);
    if (
      clearingThumbnail &&
      (existing.status === "published" || existing.status === "scheduled")
    ) {
      return {
        ok: false,
        error: "A published or scheduled post must keep its thumbnail.",
      };
    }

    // `status` isn't a field on postUpdateSchema, so this action can never
    // move a post between draft/scheduled/published/archived — transitions
    // are ADM-4's job.
    const nextSlug = data.slug ?? existing.slug;

    const columnUpdates: Partial<typeof posts.$inferInsert> = {};
    if (data.title !== undefined) columnUpdates.title = data.title;
    if (data.slug !== undefined) columnUpdates.slug = data.slug;
    if (data.bodyMd !== undefined) columnUpdates.bodyMd = data.bodyMd;
    if (data.categoryId !== undefined) {
      columnUpdates.categoryId = data.categoryId;
    }
    if (data.thumbnailUrl !== undefined) {
      columnUpdates.thumbnailUrl = data.thumbnailUrl;
    }
    if (data.bannerUrl !== undefined) {
      columnUpdates.bannerUrl = data.bannerUrl;
    }
    if (data.videoUrl !== undefined) {
      columnUpdates.videoUrl = data.videoUrl;
    }

    // Empty payload (a debounced autosave diffing to nothing): writing
    // nothing and expiring caches over it would be pure waste — succeed
    // without touching the DB or the cache.
    if (Object.keys(columnUpdates).length === 0 && data.tags === undefined) {
      return { ok: true, data: { id, slug: existing.slug } };
    }

    // A tags-only edit still needs to bump updated_at: the schema's
    // $onUpdate hook (src/db/schema.ts) only fires on an actual
    // `db.update(posts)` call, which would otherwise be skipped.
    if (Object.keys(columnUpdates).length === 0) {
      columnUpdates.updatedAt = new Date();
    }

    try {
      await db.transaction(async (tx) => {
        // When clearing the thumbnail, guard the write on the status still
        // being draft/archived — a concurrent publish between our read and
        // this write would otherwise slip a "" thumbnail onto a live post.
        const updated = await tx
          .update(posts)
          .set(columnUpdates)
          .where(
            clearingThumbnail
              ? and(
                  eq(posts.id, id),
                  notInArray(posts.status, ["published", "scheduled"]),
                )
              : eq(posts.id, id),
          )
          .returning({ id: posts.id });

        if (clearingThumbnail && updated.length === 0) {
          throw new ThumbnailInvariantError();
        }

        if (data.tags !== undefined) {
          await setPostTags(tx, id, data.tags);
        }
      });
    } catch (err) {
      if (err instanceof ThumbnailInvariantError) {
        return {
          ok: false,
          error: "A published or scheduled post must keep its thumbnail.",
        };
      }
      // Unlike create, an explicit slug edit that collides is not retried —
      // the author picked that slug on purpose and should choose another.
      // isPostSlugCollision scopes the mapping: a post_tags PK collision (or
      // any other unique violation) must not surface as "That slug is taken."
      if (isPostSlugCollision(err)) {
        return { ok: false, error: "That slug is taken." };
      }
      throw err;
    }

    // Cheap and correct even for drafts: revalidating a tag nobody has
    // cached is a no-op. Call after the transaction commits.
    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${nextSlug}`, IMMEDIATE);
    if (nextSlug !== existing.slug) {
      revalidateTag(`post:${existing.slug}`, IMMEDIATE);
    }

    return { ok: true, data: { id, slug: nextSlug } };
  } catch (err) {
    console.error("updatePost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function deletePost(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  // Session/role checked before parsing the id (engineering rules: session
  // -> role -> everything else) — an unauthenticated or unauthorized caller
  // gets only "Not authorized.", never id-format validation feedback.
  const session = await staffSession();
  // Hard delete is admin-only; authors archive instead, which is
  // recoverable (ADM-4/FR-7.6) — deletion is not.
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  try {
    const [deleted] = await db
      .delete(posts)
      .where(eq(posts.id, id))
      .returning({ id: posts.id, slug: posts.slug });

    if (!deleted) {
      return { ok: false, error: "Post not found." };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${deleted.slug}`, IMMEDIATE);

    return { ok: true, data: { id: deleted.id } };
  } catch (err) {
    console.error("deletePost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Lifecycle columns loaded together by the status/schedule actions below.
type LifecycleRow = {
  authorId: string;
  slug: string;
  status: PostStatus;
  thumbnailUrl: string;
  publishAt: Date | null;
  archiveAt: Date | null;
};

const CONFLICT_ERROR = "This post was changed elsewhere. Reload and try again.";

// Loads the lifecycle columns and runs the shared ownership check (authors
// scoped to their own rows, admins unscoped; §5.7). Returns the row, or an
// ActionResult error to hand straight back to the caller.
async function loadOwnedLifecycle(
  id: string,
  session: NonNullable<Awaited<ReturnType<typeof staffSession>>>,
): Promise<{ ok: true; post: LifecycleRow } | { ok: false; error: string }> {
  const [existing] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      status: posts.status,
      thumbnailUrl: posts.thumbnailUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);

  if (!existing) return { ok: false, error: "Post not found." };
  if (session.user.role !== "admin" && existing.authorId !== session.user.id) {
    return { ok: false, error: "Not authorized." };
  }
  return { ok: true, post: existing };
}

// Null-safe "this column still holds the value we read" guard, for CAS on
// nullable timestamp columns.
function unchanged(column: PgColumn, value: Date | null): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

// Applies `updates` only while the post still matches the state we read
// (compare-and-swap): always guards on `fromStatus`, plus any `extraGuards`
// (e.g. a sibling timestamp unchanged) so a concurrent lifecycle change on
// another tab/device matches no row. That lets the caller report a conflict
// instead of silently clobbering the other write — and, for the schedule
// actions, prevents a race from committing publish_at >= archive_at behind
// each action's individually-valid check. Returns whether the write landed.
async function casUpdate(
  id: string,
  fromStatus: PostStatus,
  updates: Partial<typeof posts.$inferInsert>,
  extraGuards: SQL[] = [],
): Promise<boolean> {
  const updated = await db
    .update(posts)
    .set(updates)
    .where(and(eq(posts.id, id), eq(posts.status, fromStatus), ...extraGuards))
    .returning({ id: posts.id });
  return updated.length > 0;
}

// Move a post between statuses (draft/scheduled/published/archived). The
// allowed moves live in the pure state machine (src/lib/post-status.ts);
// this action adds the auth/ownership boundary, the publish-time thumbnail
// gate, and the timestamp side-effects. Scheduling a FUTURE publish_at/
// archive_at is a separate action (schedulePublish/scheduleArchive) — this
// only does immediate moves.
export async function transitionPostStatus(
  id: string,
  to: string,
): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  // Session/role before parsing anything (engineering rules: session -> role
  // -> everything else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const toResult = z.enum(POST_STATUSES).safeParse(to);
  if (!toResult.success) {
    return { ok: false, error: "Invalid status." };
  }
  const target = toResult.data;

  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const existing = loaded.post;

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
    if (target === "published" && !isRenderableImageSrc(existing.thumbnailUrl)) {
      return {
        ok: false,
        error: "Add a thumbnail image before publishing.",
      };
    }

    const now = new Date();
    const updates: Partial<typeof posts.$inferInsert> = { status: target };
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

    if (!(await casUpdate(id, existing.status, updates))) {
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
export async function schedulePublish(
  id: string,
  publishAtInput: unknown,
): Promise<ActionResult<{ id: string; publishAt: string }>> {
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const dateResult = z.coerce.date().safeParse(publishAtInput);
  if (!dateResult.success) {
    return { ok: false, error: "Enter a valid date and time." };
  }
  const publishAt = dateResult.data;

  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

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
    if (post.status === "scheduled" && post.publishAt !== null && post.publishAt <= now) {
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

    // CAS also guards archive_at unchanged: a concurrent scheduleArchive
    // could otherwise slip a nearer archive_at past the check above, leaving
    // publish_at >= archive_at (a post that can never become visible).
    if (
      !(await casUpdate(
        id,
        post.status,
        { status: "scheduled", publishAt },
        [unchanged(posts.archiveAt, post.archiveAt)],
      ))
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
export async function scheduleArchive(
  id: string,
  archiveAtInput: unknown,
): Promise<ActionResult<{ id: string; archiveAt: string }>> {
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const dateResult = z.coerce.date().safeParse(archiveAtInput);
  if (!dateResult.success) {
    return { ok: false, error: "Enter a valid date and time." };
  }
  const archiveAt = dateResult.data;

  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

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

    // CAS guards publish_at unchanged: mirror of schedulePublish, so a
    // concurrent reschedule can't move publish_at past this archive time.
    if (
      !(await casUpdate(id, post.status, { archiveAt }, [
        unchanged(posts.publishAt, post.publishAt),
      ]))
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
export async function cancelScheduledArchive(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  try {
    const loaded = await loadOwnedLifecycle(id, session);
    if (!loaded.ok) return loaded;
    const post = loaded.post;

    // Nothing scheduled — succeed without a write or cache churn.
    if (post.archiveAt === null) {
      return { ok: true, data: { id } };
    }

    if (!(await casUpdate(id, post.status, { archiveAt: null }))) {
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
