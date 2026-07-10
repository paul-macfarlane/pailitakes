import "server-only";

import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { categories, posts, postTags, tags, user } from "@/db/schema";
import { PUBLIC_STATUSES } from "@/lib/posts/status";

// Tag list for a single post as a JSON array, ordered by name, empty when the
// post has none. Shared so the public post detail and the ADM-7 preview
// aggregate tags identically (used with a leftJoin on postTags/tags + a
// groupBy on the post). Exported for src/lib/admin-posts.ts's preview query.
export const postTagsAgg = sql<
  { slug: string; name: string }[]
>`coalesce(json_agg(json_build_object('slug', ${tags.slug}, 'name', ${tags.name}) order by ${tags.name}) filter (where ${tags.id} is not null), '[]'::json)`;

// A post is publicly visible iff (design §4):
//   status IN ('published','scheduled') AND publish_at <= now
//   AND (archive_at IS NULL OR archive_at > now)
// `now` is injectable for tests; callers use the default.
export function visiblePostsWhere(now: Date = new Date()): SQL {
  // and() is `undefined` only when called with zero conditions.
  return and(
    inArray(posts.status, [...PUBLIC_STATUSES]),
    lte(posts.publishAt, now),
    or(isNull(posts.archiveAt), gt(posts.archiveAt, now)),
  )!;
}

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

// Cards need only enough raw markdown to derive a ~160-char excerpt
// (src/lib/excerpt.ts, POST-4) — not whole post bodies. Exported so callers
// can tell a truncated excerptSource (length === this) from a short body.
export const EXCERPT_SOURCE_CHARS = 1000;

export type PostCard = {
  id: string;
  slug: string;
  title: string;
  thumbnailUrl: string;
  excerptSource: string;
  publishAt: Date;
  category: { slug: string; name: string };
  author: { name: string; image: string | null };
};

export async function listVisiblePosts({
  limit = DEFAULT_LIMIT,
  offset = 0,
  now,
}: { limit?: number; offset?: number; now?: Date } = {}): Promise<{
  posts: PostCard[];
  hasMore: boolean;
}> {
  // Also neutralizes NaN / non-integers: this clamp is the only sanitization
  // when a caller forwards loosely-parsed query params.
  const clampedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), MIN_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const clampedOffset = Number.isFinite(offset)
    ? Math.max(Math.trunc(offset), 0)
    : 0;

  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      thumbnailUrl: posts.thumbnailUrl,
      excerptSource: sql<string>`left(${posts.bodyMd}, ${EXCERPT_SOURCE_CHARS})`,
      publishAt: posts.publishAt,
      category: { slug: categories.slug, name: categories.name },
      author: { name: user.name, image: user.image },
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .where(visiblePostsWhere(now))
    // id tiebreaker: ties on publishAt would otherwise reorder arbitrarily
    // between offset pages, duplicating/dropping posts across load-more.
    .orderBy(desc(posts.publishAt), desc(posts.id))
    .limit(clampedLimit + 1)
    .offset(clampedOffset);

  return {
    // The visibility predicate requires publish_at <= now, so publishAt is
    // never null on returned rows — narrow the column's nullable type.
    posts: rows.slice(0, clampedLimit) as PostCard[],
    hasMore: rows.length > clampedLimit,
  };
}

export type PostDetail = {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
  publishAt: Date;
  updatedAt: Date;
  commentsLocked: boolean;
  category: { slug: string; name: string };
  author: { name: string; image: string | null };
  tags: { slug: string; name: string }[];
};

export async function getVisiblePostBySlug(
  slug: string,
  now?: Date,
): Promise<PostDetail | null> {
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      bodyMd: posts.bodyMd,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      publishAt: posts.publishAt,
      updatedAt: posts.updatedAt,
      commentsLocked: posts.commentsLocked,
      category: { slug: categories.slug, name: categories.name },
      author: { name: user.name, image: user.image },
      tags: postTagsAgg,
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .leftJoin(postTags, eq(postTags.postId, posts.id))
    .leftJoin(tags, eq(tags.id, postTags.tagId))
    .where(and(eq(posts.slug, slug), visiblePostsWhere(now)))
    .groupBy(posts.id, categories.id, user.id)
    .limit(1);

  // Same publishAt narrowing as listVisiblePosts: the predicate excludes
  // null publish_at rows.
  return (rows[0] as PostDetail | undefined) ?? null;
}
