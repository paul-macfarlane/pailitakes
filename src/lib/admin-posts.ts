import "server-only";

import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { categories, posts, postTags, tags, user } from "@/db/schema";
import { tagToSlug } from "@/lib/post-input";
import { usesDraftBuffer, type PostStatus } from "@/lib/post-status";
import { postTagsAgg } from "@/lib/posts";
import { escapeLike } from "@/lib/sql-like";

// Editor-facing shape (ADM-2): everything the post editor form reads/writes.
// Thumbnail/banner/video are deliberately absent from the editor UI (ADM-6),
// but the row still carries them — omitted here since nothing reads them yet.
export type EditablePost = {
  id: string;
  title: string;
  slug: string;
  bodyMd: string;
  status: "draft" | "scheduled" | "published" | "archived";
  categoryId: number;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
  // Scheduling timestamps (ADM-5); null until a publish/archive is scheduled.
  publishAt: Date | null;
  archiveAt: Date | null;
  tags: string[];
  // Draft-of-published (ADR-0011): true when a public post has staged edits.
  // When true, the content fields above are the STAGED snapshot, not the live
  // post — the editor edits (and autosaves to) the pending copy.
  hasPendingChanges: boolean;
  draftUpdatedAt: Date | null;
};

// Loads a single post for editing. Authors are scoped to their own rows;
// admins are unscoped (design §5.7). Returns null both when the post doesn't
// exist and when an author isn't its owner — collapsing "not found" and "not
// yours" into the same response avoids an existence oracle.
export async function getEditablePost(
  id: string,
  // `role` stays loose (string) because Better Auth's inferred session types
  // it as string, not the pg enum — same as src/lib/authz.ts's isStaff.
  user: { id: string; role?: string | null },
): Promise<EditablePost | null> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      bodyMd: posts.bodyMd,
      status: posts.status,
      categoryId: posts.categoryId,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      authorId: posts.authorId,
      draft: posts.draft,
      draftUpdatedAt: posts.draftUpdatedAt,
      tagName: tags.name,
    })
    .from(posts)
    .leftJoin(postTags, eq(postTags.postId, posts.id))
    .leftJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(posts.id, id))
    .orderBy(asc(tags.name));

  const [first] = rows;
  if (!first) return null;
  if (user.role !== "admin" && first.authorId !== user.id) return null;

  // On a public post, edits are staged (ADR-0011): show the pending snapshot so
  // the author edits their in-progress copy, not the live content. On any other
  // status the buffer is ignored (drafts/archived edit live).
  const draft = usesDraftBuffer(first.status) ? first.draft : null;
  const liveTags = rows.flatMap((row) => (row.tagName ? [row.tagName] : []));

  return {
    id: first.id,
    title: draft?.title ?? first.title,
    slug: draft?.slug ?? first.slug,
    bodyMd: draft?.bodyMd ?? first.bodyMd,
    status: first.status,
    categoryId: draft?.categoryId ?? first.categoryId,
    thumbnailUrl: draft?.thumbnailUrl ?? first.thumbnailUrl,
    // banner/video can legitimately be null in the snapshot — pick from the
    // snapshot when it exists, not via ?? (which would fall back to live null).
    bannerUrl: draft ? draft.bannerUrl : first.bannerUrl,
    videoUrl: draft ? draft.videoUrl : first.videoUrl,
    publishAt: first.publishAt,
    archiveAt: first.archiveAt,
    tags: draft ? draft.tags : liveTags,
    hasPendingChanges: draft !== null,
    draftUpdatedAt: draft ? first.draftUpdatedAt : null,
  };
}

// Full render shape for the ADM-7 preview — the same fields getVisiblePost-
// BySlug returns, but publishAt may be null (drafts) and status is exposed so
// the preview page can badge "not yet public".
export type PreviewPost = {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  status: "draft" | "scheduled" | "published" | "archived";
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
  publishAt: Date | null;
  archiveAt: Date | null;
  category: { slug: string; name: string };
  author: { name: string; image: string | null };
  tags: { slug: string; name: string }[];
  // Draft-of-published (ADR-0011): true when the fields above are a public
  // post's STAGED snapshot (what "Publish changes" will make live), so the
  // preview shows pending edits rather than the current live content.
  hasPendingChanges: boolean;
};

// Loads a post by id for private preview, BYPASSING visiblePostsWhere() so a
// draft/scheduled/archived post can be viewed exactly as it will publish
// (design §5.7). Ownership-scoped like getEditablePost: authors see only their
// own, admin sees all; returns null for missing OR not-owned (no oracle).
export async function getPostForPreview(
  id: string,
  user_: { id: string; role?: string | null },
): Promise<PreviewPost | null> {
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      bodyMd: posts.bodyMd,
      status: posts.status,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      authorId: posts.authorId,
      categoryId: posts.categoryId,
      draft: posts.draft,
      category: { slug: categories.slug, name: categories.name },
      author: { name: user.name, image: user.image },
      tags: postTagsAgg,
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .leftJoin(postTags, eq(postTags.postId, posts.id))
    .leftJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(posts.id, id))
    .groupBy(posts.id, categories.id, user.id)
    .limit(1);

  const [row] = rows;
  if (!row) return null;
  if (user_.role !== "admin" && row.authorId !== user_.id) return null;

  // On a public post, preview the STAGED snapshot (what will go live), not the
  // current live content (ADR-0011). Category and tags come from the live join
  // by default; when previewing a snapshot, resolve the staged category name
  // and derive tag slugs so the preview reflects the pending edit faithfully.
  const draft = usesDraftBuffer(row.status) ? row.draft : null;

  let category = row.category;
  let previewTags = row.tags;
  if (draft) {
    if (draft.categoryId !== row.categoryId) {
      const [staged] = await db
        .select({ slug: categories.slug, name: categories.name })
        .from(categories)
        .where(eq(categories.id, draft.categoryId))
        .limit(1);
      if (staged) category = staged;
    }
    const seen = new Set<string>();
    previewTags = [];
    for (const name of draft.tags) {
      const slug = tagToSlug(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      previewTags.push({ slug, name });
    }
  }

  // authorId is loaded only for the ownership check above, not part of the
  // render shape.
  return {
    id: row.id,
    slug: draft?.slug ?? row.slug,
    title: draft?.title ?? row.title,
    bodyMd: draft?.bodyMd ?? row.bodyMd,
    status: row.status,
    thumbnailUrl: draft?.thumbnailUrl ?? row.thumbnailUrl,
    bannerUrl: draft ? draft.bannerUrl : row.bannerUrl,
    videoUrl: draft ? draft.videoUrl : row.videoUrl,
    publishAt: row.publishAt,
    archiveAt: row.archiveAt,
    category,
    author: row.author,
    tags: previewTags,
    hasPendingChanges: draft !== null,
  };
}

// Dashboard list row (ADM-8, FR-7.1). Only the columns the list renders —
// publish_at still drives the "published" sort via ORDER BY without being
// selected.
export type AdminPostRow = {
  id: string;
  title: string;
  status: PostStatus;
  updatedAt: Date;
  category: { name: string };
  author: { name: string };
};

export type AdminPostSort = "updated" | "published";

export const ADMIN_POSTS_PAGE_SIZE = 25;

// Filtered/sorted post list for the admin dashboard. SECURITY: authors are
// hard-scoped to their own rows here (§5.7) — a non-admin's `authorId` filter
// is ignored, never widening their view. Fetches one extra row to report
// hasMore without a separate count query.
export async function listAdminPosts(params: {
  user: { id: string; role?: string | null };
  status?: PostStatus;
  categoryId?: number;
  authorId?: string;
  q?: string;
  sort?: AdminPostSort;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminPostRow[]; hasMore: boolean }> {
  const limit = Math.min(
    Math.max(params.limit ?? ADMIN_POSTS_PAGE_SIZE, 1),
    100,
  );
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (params.user.role !== "admin") {
    // Non-admins see only their own posts, regardless of any authorId filter.
    conditions.push(eq(posts.authorId, params.user.id));
  } else if (params.authorId) {
    conditions.push(eq(posts.authorId, params.authorId));
  }
  if (params.status) conditions.push(eq(posts.status, params.status));
  if (params.categoryId) {
    conditions.push(eq(posts.categoryId, params.categoryId));
  }
  // Free-text title search (admin dashboard is uncached, so a simple ILIKE
  // contains is fine — public search uses FTS, FR-3.1). Blank/whitespace is a
  // no-op filter.
  const q = params.q?.trim();
  if (q) conditions.push(ilike(posts.title, `%${escapeLike(q)}%`));

  // Drafts have a null publish_at — keep them last when sorting by publish
  // date. A secondary id sort keeps pagination stable across ties.
  const orderBy =
    params.sort === "published"
      ? [sql`${posts.publishAt} desc nulls last`, desc(posts.id)]
      : [desc(posts.updatedAt), desc(posts.id)];

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      updatedAt: posts.updatedAt,
      category: { name: categories.name },
      author: { name: user.name },
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

// Staff users for the dashboard's author filter (admin only).
export async function listAuthorOptions(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.role, ["author", "admin"]))
    .orderBy(asc(user.name));
}

export type CategoryOption = { id: number; name: string };

// Active categories for the editor's category select, ordered for display.
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}
