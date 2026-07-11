import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";

import { LoadMorePosts } from "@/app/(public)/_components/load-more-posts";
import { PostCard } from "@/components/post-card";
import { getTagFeed } from "@/lib/posts/home-feed";
import { slugParamSchema } from "@/lib/posts/input";
import { getTagBySlug } from "@/lib/posts/posts";

// Cache Components requires generateStaticParams to return at least one
// param set for build-time validation — CI builds against an empty
// database, so a never-linked placeholder (renders 404) stands in rather
// than querying for real slugs, same idiom as the post page.
export function generateStaticParams(): { slug: string }[] {
  return [{ slug: "build-validation-placeholder" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugResult = slugParamSchema.safeParse(slug);
  if (!slugResult.success) return {};

  const tag = await getTagBySlug(slugResult.data);
  if (!tag) return {};
  return { title: `Tagged "${tag.name}"` };
}

// Page-level "use cache" (not a Suspense hole), tagged `post-list` per the
// rendering table (design §2/§3) — same reasoning as the post page: the 404
// for an unknown slug must be computed before anything streams.
export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  "use cache";
  const { slug } = await params;
  const slugResult = slugParamSchema.safeParse(slug);
  if (!slugResult.success) notFound();

  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  const tag = await getTagBySlug(slugResult.data);
  if (!tag) notFound();

  const { posts, hasMore } = await getTagFeed(slugResult.data, 0);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Tagged &ldquo;{tag.name}&rdquo;
      </h1>

      <div className="mt-8 flex flex-col gap-6">
        {posts.length === 0 ? (
          <p className="text-muted-foreground">No posts yet.</p>
        ) : (
          <>
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
            <LoadMorePosts
              initialSlugs={posts.map((post) => post.slug)}
              initialHasMore={hasMore}
              filter={{ kind: "tag", slug: slugResult.data }}
            />
          </>
        )}
      </div>
    </main>
  );
}
