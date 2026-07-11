import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { deriveExcerpt } from "@/lib/content/excerpt";
import { EXCERPT_SOURCE_CHARS, listVisiblePosts } from "@/lib/posts/posts";

export const HOME_PAGE_SIZE = 10;

// Serializable card data shared by the home page (RSC) and /api/posts
// (load-more fetches) — dates as ISO strings so the client island can render
// the same PostCard component.
export type HomeFeedCard = {
  slug: string;
  title: string;
  thumbnailUrl: string;
  excerpt: string;
  publishAt: string;
  category: { slug: string; name: string };
  author: { name: string };
};

export type HomeFeed = { posts: HomeFeedCard[]; hasMore: boolean };

// Shared by getHomeFeed/getCategoryFeed/getTagFeed: same PostCard -> card
// mapping, only the underlying listVisiblePosts filter differs.
function toHomeFeed({
  posts,
  hasMore,
}: Awaited<ReturnType<typeof listVisiblePosts>>): HomeFeed {
  return {
    posts: posts.map((post) => ({
      slug: post.slug,
      title: post.title,
      thumbnailUrl: post.thumbnailUrl,
      excerpt: deriveExcerpt(post.excerptSource, {
        // left(body_md, N) filled the whole window ⇒ the tail may be cut
        // mid-construct; shorter means the source is the complete body.
        sourceTruncated: post.excerptSource.length === EXCERPT_SOURCE_CHARS,
      }),
      publishAt: post.publishAt.toISOString(),
      category: post.category,
      author: { name: post.author.name },
    })),
    hasMore,
  };
}

// Cached per offset, tagged `post-list` (design §3): publish/edit/archive
// actions and the revalidation cron invalidate every cached feed page in one
// revalidateTag call; 60s revalidation is the scheduled-publish safety net.
export async function getHomeFeed(offset: number): Promise<HomeFeed> {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  return toHomeFeed(await listVisiblePosts({ limit: HOME_PAGE_SIZE, offset }));
}

// Home's `?category=` browse mode (SRCH-2, FR-2.4). An inactive/unknown
// category degrades to an empty feed rather than a 404 — deactivation only
// hides the category from pickers and the pill bar, never from a direct
// deep link (locked decision, see the home page component). Cache key
// includes categorySlug/offset automatically.
export async function getCategoryFeed(
  categorySlug: string,
  offset: number,
): Promise<HomeFeed> {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  return toHomeFeed(
    await listVisiblePosts({ limit: HOME_PAGE_SIZE, offset, categorySlug }),
  );
}

// /tags/[slug] (SRCH-2, FR-2.4).
export async function getTagFeed(
  tagSlug: string,
  offset: number,
): Promise<HomeFeed> {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  return toHomeFeed(
    await listVisiblePosts({ limit: HOME_PAGE_SIZE, offset, tagSlug }),
  );
}
