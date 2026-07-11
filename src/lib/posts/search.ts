import "server-only";

import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, postTags, posts, tags } from "@/db/schema";
import { visiblePostsWhere } from "@/lib/posts/posts";
import { escapeLike } from "@/lib/shared/sql-like";

// ts_headline StartSel/StopSel markers (design §5.5). Snippets are rendered
// as plain text and NEVER dangerouslySetInnerHTML'd — the UI (SRCH-5) splits
// the snippet string on these tokens and wraps the matched span in <mark>
// itself, so the delimiters just need to be distinctive plain text that
// won't collide with ordinary prose (unlike e.g. "<b>"/"</b>", which would
// tempt a naive caller into raw-HTML rendering and reopen an XSS surface).
export const SNIPPET_START = "[[[";
export const SNIPPET_END = "]]]";

export type SearchResult = {
  id: string;
  slug: string;
  title: string;
  thumbnailUrl: string;
  // Non-null: every row satisfies visiblePostsWhere(), which requires
  // publish_at <= now (mirrors listVisiblePosts's PostCard narrowing).
  publishAt: Date;
  category: { slug: string; name: string };
  snippet: string;
};

// Mirrors listVisiblePosts's clamp constants (src/lib/posts/posts.ts) —
// not exported there, so duplicated here rather than reaching around
// posts.ts's module boundary for three primitives.
const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export async function searchVisiblePosts(opts: {
  q: string;
  categorySlug?: string;
  limit?: number;
  offset?: number;
  now?: Date;
}): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const q = opts.q.trim();
  // An empty/whitespace query has no meaningful tsquery or ILIKE term —
  // skip the round trip entirely rather than running a query that (per
  // websearch_to_tsquery semantics) would match nothing anyway.
  if (q === "") {
    return { results: [], hasMore: false };
  }

  const clampedLimit = Number.isFinite(opts.limit)
    ? Math.min(Math.max(Math.trunc(opts.limit!), MIN_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const clampedOffset = Number.isFinite(opts.offset)
    ? Math.max(Math.trunc(opts.offset!), 0)
    : 0;

  // websearch_to_tsquery tolerates arbitrary user input (bare quotes,
  // operators, stopword-only text) without throwing — it's built for raw
  // search-box text, unlike the stricter to_tsquery/plainto_tsquery. Always
  // parameterized via Drizzle's sql tag, never string-interpolated. Reused
  // (by reference) in the match condition, ORDER BY rank, and the snippet —
  // Postgres dedupes the repeated parameter, Drizzle re-inlines the fragment
  // at each use site.
  const tsQuery = sql`websearch_to_tsquery('english', ${q})`;
  const rank = sql`ts_rank(${posts.search}, ${tsQuery})`;
  const likeTerm = `%${escapeLike(q)}%`;

  // A stopword-only query (e.g. "the") produces an empty tsquery, so
  // `search @@ q` is false for every row — the tag/category ILIKE arms
  // below still apply. That's intentional, not a bug: no special-casing.
  const tagMatch = exists(
    db
      .select({ one: sql`1` })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(and(eq(postTags.postId, posts.id), ilike(tags.name, likeTerm))),
  );

  const matchCondition = or(
    sql`${posts.search} @@ ${tsQuery}`,
    tagMatch,
    ilike(categories.name, likeTerm),
  )!;

  const whereCondition = and(
    visiblePostsWhere(opts.now),
    matchCondition,
    opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined,
  )!;

  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      thumbnailUrl: posts.thumbnailUrl,
      publishAt: posts.publishAt,
      category: { slug: categories.slug, name: categories.name },
      // When only the tag/category ILIKE arms matched (no lexeme hit in the
      // body), ts_headline has nothing to highlight and degrades to the
      // document head with no StartSel/StopSel markers — acceptable, the UI
      // just renders it as plain unhighlighted text.
      snippet: sql<string>`ts_headline('english', ${posts.bodyMd}, ${tsQuery}, ${`StartSel=${SNIPPET_START},StopSel=${SNIPPET_END},MaxWords=30,MinWords=12`})`,
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .where(whereCondition)
    // id tiebreak matches listVisiblePosts: ties on rank/publishAt would
    // otherwise reorder arbitrarily between offset pages.
    .orderBy(desc(rank), desc(posts.publishAt), desc(posts.id))
    .limit(clampedLimit + 1)
    .offset(clampedOffset);

  return {
    results: rows.slice(0, clampedLimit) as SearchResult[],
    hasMore: rows.length > clampedLimit,
  };
}
