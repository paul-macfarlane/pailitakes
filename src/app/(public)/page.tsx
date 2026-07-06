import { getHomeFeed } from "@/lib/home-feed";
import { LoadMorePosts } from "@/components/load-more-posts";
import { PostCard } from "@/components/post-card";

// Whole page cached and tagged via getHomeFeed (`post-list`, 60s — design
// §3); no request data on the home route.
export default async function HomePage() {
  "use cache";

  const { posts, hasMore } = await getHomeFeed(0);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Paulitakes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Hot takes, cold analysis.
      </p>

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
