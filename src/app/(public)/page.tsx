import { cacheLife, cacheTag } from "next/cache";

import { getHomeFeed } from "@/lib/posts/home-feed";
import { LoadMorePosts } from "@/app/(public)/_components/load-more-posts";
import { CategoryPills } from "@/components/category-pills";
import { PostCard } from "@/components/post-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listActiveCategories } from "@/lib/categories/data";

// Whole page cached and tagged `post-list` (design §3): getHomeFeed's own
// tag covers the post query, and this page-level tag/life is needed on top
// because the page also reads listActiveCategories directly (category
// create/update/deactivate revalidates `post-list`, same tag, so this stays
// in sync with the pills below).
export default async function HomePage() {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  const [{ posts, hasMore }, categories] = await Promise.all([
    getHomeFeed(0),
    listActiveCategories(),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Paulitakes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Hot takes, cold analysis.
      </p>

      {/* Plain GET form: submits without any JS (Label/Input hydrate but
          SSR to native elements, so the cached shell works pre-hydration).
          Live debounced typing lives on /search itself (SearchForm). */}
      <form action="/search" role="search" className="mt-6">
        <Label htmlFor="home-search-q" className="sr-only">
          Search posts
        </Label>
        <Input
          id="home-search-q"
          type="search"
          name="q"
          placeholder="Search posts…"
        />
      </form>

      <div className="mt-4">
        <CategoryPills categories={categories} />
      </div>

      {/* Announcements slot — banner lands with ANN-3. */}

      <div className="mt-8 flex flex-col gap-6">
        {posts.length === 0 ? (
          <p className="text-muted-foreground">
            No posts yet. Check back soon.
          </p>
        ) : (
          <>
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
            <LoadMorePosts
              initialSlugs={posts.map((post) => post.slug)}
              initialHasMore={hasMore}
            />
          </>
        )}
      </div>
    </main>
  );
}
