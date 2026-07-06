import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { deriveExcerpt } from "@/lib/excerpt";
import { EXCERPT_SOURCE_CHARS, listVisiblePosts } from "@/lib/posts";

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

// Cached per offset, tagged `post-list` (design §3): publish/edit/archive
// actions and the revalidation cron invalidate every cached feed page in one
// revalidateTag call; 60s revalidation is the scheduled-publish safety net.
export async function getHomeFeed(offset: number): Promise<HomeFeed> {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  const { posts, hasMore } = await listVisiblePosts({
    limit: HOME_PAGE_SIZE,
    offset,
  });

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
