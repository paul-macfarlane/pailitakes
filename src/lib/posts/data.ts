import "server-only";

// Pure DB access for the posts server actions (create/update/delete, staged
// drafts, lifecycle transitions) — queries/mutations plus error
// classification only. Business rules (what to write, when, and why) live in
// src/lib/posts/service/*.

import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db, type Db } from "@/db";
import { categories, posts, postTags, tags } from "@/db/schema";
import type { StaffSession } from "@/lib/auth/guards";
import { tagToSlug, type PostDraft, type PostInput } from "@/lib/posts/input";
import type { PostStatus } from "@/lib/posts/status";

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
export function isPostSlugCollision(err: unknown): boolean {
  const constraint = uniqueViolationConstraint(err);
  return constraint === "posts_slug_unique" || constraint === "";
}

export async function categoryExists(categoryId: number): Promise<boolean> {
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
export async function setPostTags(
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

export async function insertPost(
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

// The post's current tag NAMES — the seed for a draft snapshot's tags on the
// first staged edit (before posts.draft exists to carry them).
export async function loadPostTagNames(postId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(postTags.postId, postId));
  return rows.map((row) => row.name);
}

// Existing row loaded by updatePost to decide direct-write vs staged-draft
// and to run the ownership check.
export type ExistingPostForUpdate = {
  authorId: string;
  slug: string;
  status: PostStatus;
  publishAt: Date | null;
  archiveAt: Date | null;
};

export async function loadPostForUpdate(
  id: string,
): Promise<ExistingPostForUpdate | undefined> {
  const [row] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      status: posts.status,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  return row;
}

// Thrown inside writePostColumns's transaction to roll back and surface the
// public-thumbnail invariant when a concurrent publish wins the race.
class ThumbnailInvariantError extends Error {}

export type WritePostColumnsResult =
  | { ok: true }
  | { ok: false; reason: "thumbnail-invariant" }
  | { ok: false; reason: "slug-collision" };

export type PostColumnUpdate = Partial<typeof posts.$inferInsert>;

// Applies a direct (non-staged) column update to a post, optionally guarded
// against the public-thumbnail invariant, and replaces its tag set in the
// same transaction when `opts.tags` is provided. Used by updatePost for
// draft/archived posts and any scheduled-but-not-yet-public post (writes
// that go straight to the live columns, not into the draft buffer).
export async function writePostColumns(
  id: string,
  columnUpdates: PostColumnUpdate,
  opts: { guardThumbnailInvariant: boolean; tags?: string[] },
): Promise<WritePostColumnsResult> {
  try {
    await db.transaction(async (tx) => {
      // When clearing the thumbnail, guard the write on the status still
      // being draft/archived — a concurrent publish between our read and
      // this write would otherwise slip a "" thumbnail onto a live post.
      const updated = await tx
        .update(posts)
        .set(columnUpdates)
        .where(
          opts.guardThumbnailInvariant
            ? and(
                eq(posts.id, id),
                notInArray(posts.status, ["published", "scheduled"]),
              )
            : eq(posts.id, id),
        )
        .returning({ id: posts.id });

      if (opts.guardThumbnailInvariant && updated.length === 0) {
        throw new ThumbnailInvariantError();
      }

      if (opts.tags !== undefined) {
        await setPostTags(tx, id, opts.tags);
      }
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ThumbnailInvariantError) {
      return { ok: false, reason: "thumbnail-invariant" };
    }
    // Unlike create, an explicit slug edit that collides is not retried — the
    // author picked that slug on purpose and should choose another.
    // isPostSlugCollision scopes the mapping: a post_tags PK collision (or any
    // other unique violation) must not surface as "That slug is taken."
    if (isPostSlugCollision(err)) {
      return { ok: false, reason: "slug-collision" };
    }
    throw err;
  }
}

export async function deletePostRow(
  id: string,
): Promise<{ id: string; slug: string } | undefined> {
  const [deleted] = await db
    .delete(posts)
    .where(eq(posts.id, id))
    .returning({ id: posts.id, slug: posts.slug });
  return deleted;
}

// Loads the draft-buffer columns and runs the shared ownership check for the
// publish/discard actions (the counterpart to loadOwnedLifecycle for the
// status actions). One source of truth for the ownership predicate so it
// can't drift.
export async function loadOwnedDraft(
  id: string,
  session: StaffSession,
): Promise<
  | {
      ok: true;
      post: {
        slug: string;
        draft: PostDraft | null;
        draftUpdatedAt: Date | null;
      };
    }
  | { ok: false; error: string }
> {
  const [existing] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      draft: posts.draft,
      draftUpdatedAt: posts.draftUpdatedAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);

  if (!existing) return { ok: false, error: "Post not found." };
  if (session.user.role !== "admin" && existing.authorId !== session.user.id) {
    return { ok: false, error: "Not authorized." };
  }
  return {
    ok: true,
    post: {
      slug: existing.slug,
      draft: existing.draft,
      draftUpdatedAt: existing.draftUpdatedAt,
    },
  };
}

// Row shape used by stageDraftEdit (src/lib/posts/service/crud.ts) to build
// the merge base and the "reverted to live" comparison.
export type StageDraftBaseRow = {
  draft: PostDraft | null;
  draftUpdatedAt: Date | null;
  title: string;
  slug: string;
  bodyMd: string;
  categoryId: number;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
};

export async function loadStageDraftBase(
  id: string,
): Promise<StageDraftBaseRow | undefined> {
  const [row] = await db
    .select({
      draft: posts.draft,
      draftUpdatedAt: posts.draftUpdatedAt,
      title: posts.title,
      slug: posts.slug,
      bodyMd: posts.bodyMd,
      categoryId: posts.categoryId,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  return row;
}

// Immediate slug-collision check for a staged edit (parity with the
// live-write path): the staged slug lives in jsonb with no unique
// constraint, so a clash would otherwise stay hidden until publish.
export async function findSlugClash(
  slug: string,
  excludingId: string,
): Promise<boolean> {
  const [clash] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), ne(posts.id, excludingId)))
    .limit(1);
  return clash !== undefined;
}

// Null-safe "this column still holds the value we read" guard, for CAS on
// nullable timestamp columns.
export function unchanged(column: PgColumn, value: Date | null): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

// Both the clear and set writes below CAS on draftUpdatedAt so a concurrent
// stage/publish that changed the buffer between our read and this write
// matches no row — a conflict, not a silent clobber — and on status so a
// concurrent unpublish can't strand the snapshot on a now-draft post.
function stageDraftGuard(id: string, draftUpdatedAt: Date | null): SQL {
  return and(
    eq(posts.id, id),
    inArray(posts.status, ["published", "scheduled"]),
    unchanged(posts.draftUpdatedAt, draftUpdatedAt),
  )!;
}

// Reverting edits back to the live content leaves nothing to stage — clears
// the buffer so the post isn't stuck showing "pending changes" with its
// status/schedule controls locked. Returns whether the write landed.
export async function clearStagedDraft(
  id: string,
  draftUpdatedAt: Date | null,
): Promise<boolean> {
  const cleared = await db
    .update(posts)
    .set({ draft: null, draftUpdatedAt: null })
    .where(stageDraftGuard(id, draftUpdatedAt))
    .returning({ id: posts.id });
  return cleared.length > 0;
}

// Writes (or merges onto) the staged snapshot. Returns whether the write
// landed.
export async function writeStagedDraft(
  id: string,
  draftUpdatedAt: Date | null,
  snapshot: PostDraft,
): Promise<boolean> {
  const updated = await db
    .update(posts)
    .set({ draft: snapshot, draftUpdatedAt: new Date() })
    .where(stageDraftGuard(id, draftUpdatedAt))
    .returning({ id: posts.id });
  return updated.length > 0;
}

// Promotes a staged snapshot to the live columns and clears the buffer, in
// one transaction (ADR-0011). CAS on draftUpdatedAt: a concurrent autosave
// that re-staged newer edits between the caller's read and here matches no
// row, so the transaction rolls back and the caller reports a conflict
// instead of promoting a stale snapshot and nulling the newer one.
export async function promoteStagedDraft(
  id: string,
  draftUpdatedAt: Date | null,
  draft: PostDraft,
): Promise<"promoted" | "conflict" | "slug-collision"> {
  try {
    const promoted = await db.transaction(async (tx) => {
      const rows = await tx
        .update(posts)
        .set({
          title: draft.title,
          slug: draft.slug,
          bodyMd: draft.bodyMd,
          categoryId: draft.categoryId,
          thumbnailUrl: draft.thumbnailUrl,
          bannerUrl: draft.bannerUrl,
          videoUrl: draft.videoUrl,
          draft: null,
          draftUpdatedAt: null,
        })
        .where(
          and(
            eq(posts.id, id),
            unchanged(posts.draftUpdatedAt, draftUpdatedAt),
          ),
        )
        .returning({ id: posts.id });

      if (rows.length === 0) return false;
      await setPostTags(tx, id, draft.tags);
      return true;
    });

    return promoted ? "promoted" : "conflict";
  } catch (err) {
    // A staged slug that now collides with another post's live slug: the
    // whole tx rolls back, so the buffer survives for the author to fix.
    if (isPostSlugCollision(err)) return "slug-collision";
    throw err;
  }
}

// Discards a post's staged edits (clears posts.draft) without touching the
// live content, unconditionally (no CAS — discard always wins).
export async function clearPostDraftUnconditional(id: string): Promise<void> {
  await db
    .update(posts)
    .set({ draft: null, draftUpdatedAt: null })
    .where(eq(posts.id, id));
}

// Lifecycle columns loaded together by the status/schedule actions below.
// `hasDraft` (not the buffer itself — just whether one exists) lets the
// lifecycle actions reject while a public post has unpublished staged edits.
export type LifecycleRow = {
  authorId: string;
  slug: string;
  status: PostStatus;
  thumbnailUrl: string;
  publishAt: Date | null;
  archiveAt: Date | null;
  hasDraft: boolean;
};

// Loads the lifecycle columns and runs the shared ownership check (authors
// scoped to their own rows, admins unscoped; §5.7). Returns the row, or an
// ActionResult error to hand straight back to the caller.
export async function loadOwnedLifecycle(
  id: string,
  session: StaffSession,
): Promise<{ ok: true; post: LifecycleRow } | { ok: false; error: string }> {
  const [existing] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      status: posts.status,
      thumbnailUrl: posts.thumbnailUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      hasDraft: sql<boolean>`${posts.draft} is not null`,
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

// Applies `updates` only while the post still matches the state we read
// (compare-and-swap): always guards on `fromStatus`, plus any `extraGuards`
// (e.g. a sibling timestamp unchanged) so a concurrent lifecycle change on
// another tab/device matches no row. That lets the caller report a conflict
// instead of silently clobbering the other write — and, for the schedule
// actions, prevents a race from committing publish_at >= archive_at behind
// each action's individually-valid check. Returns whether the write landed.
export async function casUpdate(
  id: string,
  fromStatus: PostStatus,
  updates: PostColumnUpdate,
  extraGuards: SQL[] = [],
): Promise<boolean> {
  const updated = await db
    .update(posts)
    .set(updates)
    .where(and(eq(posts.id, id), eq(posts.status, fromStatus), ...extraGuards))
    .returning({ id: posts.id });
  return updated.length > 0;
}

// Draft-buffer-empty guard shared by the lifecycle CAS writes below: the
// hasDraft check in loadOwnedLifecycle is read-time, so a concurrent
// first-stage edit could otherwise commit a buffer while a transition/
// schedule flips the post off the public track — stranding an invisible,
// unresolvable snapshot (ADR-0011). If a buffer landed, the guarded write
// below matches no row and the caller reports a conflict.
function noPendingDraftGuard(): SQL {
  return isNull(posts.draft);
}

// transitionPostStatus's write, keyed on the columns it needs to change
// (status, and the publishAt/archiveAt side-effects the service computed).
export async function casTransitionStatus(
  id: string,
  fromStatus: PostStatus,
  updates: PostColumnUpdate,
): Promise<boolean> {
  return casUpdate(id, fromStatus, updates, [noPendingDraftGuard()]);
}

// schedulePublish's write: CAS also guards archive_at unchanged (so a
// concurrent scheduleArchive can't slip a nearer archive_at past the
// service's pre-check, leaving publish_at >= archive_at) and `draft is null`.
export async function casSchedulePublish(
  id: string,
  fromStatus: PostStatus,
  publishAt: Date,
  currentArchiveAt: Date | null,
): Promise<boolean> {
  return casUpdate(id, fromStatus, { status: "scheduled", publishAt }, [
    unchanged(posts.archiveAt, currentArchiveAt),
    noPendingDraftGuard(),
  ]);
}

// scheduleArchive's write: CAS also guards publish_at unchanged (mirror of
// schedulePublish, so a concurrent reschedule can't move publish_at past this
// archive time) and `draft is null`.
export async function casScheduleArchive(
  id: string,
  fromStatus: PostStatus,
  archiveAt: Date,
  currentPublishAt: Date | null,
): Promise<boolean> {
  return casUpdate(id, fromStatus, { archiveAt }, [
    unchanged(posts.publishAt, currentPublishAt),
    noPendingDraftGuard(),
  ]);
}

// cancelScheduledArchive's write: plain CAS on status, no extra guards.
export async function casCancelScheduledArchive(
  id: string,
  fromStatus: PostStatus,
): Promise<boolean> {
  return casUpdate(id, fromStatus, { archiveAt: null });
}
