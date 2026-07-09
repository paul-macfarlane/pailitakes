import "server-only";

import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { categories, posts, postTags, tags, user } from "@/db/schema";
import { postTagsAgg } from "@/lib/posts";
import type { PostStatus } from "@/lib/post-status";

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

  return {
    id: first.id,
    title: first.title,
    slug: first.slug,
    bodyMd: first.bodyMd,
    status: first.status,
    categoryId: first.categoryId,
    thumbnailUrl: first.thumbnailUrl,
    bannerUrl: first.bannerUrl,
    videoUrl: first.videoUrl,
    publishAt: first.publishAt,
    archiveAt: first.archiveAt,
    tags: rows.flatMap((row) => (row.tagName ? [row.tagName] : [])),
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

  // authorId is loaded only for the ownership check above, not part of the
  // render shape.
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyMd: row.bodyMd,
    status: row.status,
    thumbnailUrl: row.thumbnailUrl,
    bannerUrl: row.bannerUrl,
    videoUrl: row.videoUrl,
    publishAt: row.publishAt,
    archiveAt: row.archiveAt,
    category: row.category,
    author: row.author,
    tags: row.tags,
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

// Escapes LIKE/ILIKE metacharacters so a user's query matches literally — the
// value is already parameterized (no injection), but bare %/_ would otherwise
// act as wildcards. Postgres uses backslash as the default LIKE escape char.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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
