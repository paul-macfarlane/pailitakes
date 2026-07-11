import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";

import { LoadMorePosts } from "@/app/(public)/_components/load-more-posts";
import { CategoryPills } from "@/components/category-pills";
import { PostCard } from "@/components/post-card";
import { getCategoryBySlug, listActiveCategories } from "@/lib/categories/data";
import { getCategoryFeed } from "@/lib/posts/home-feed";
import { slugParamSchema } from "@/lib/posts/input";

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

  const category = await getCategoryBySlug(slugResult.data);
  if (!category) return {};
  return { title: category.name };
}

// Page-level "use cache" (not a Suspense hole), tagged `post-list` per the
// rendering table (design §2/§3) — same reasoning as the post page: the 404
// for an unknown slug must be computed before anything streams. Locked
// decision (FR-2.1): a deactivated category's page stays reachable and keeps
// rendering its posts — deactivation only hides it from listActiveCategories
// (the pill bars and editor picker), not from the public. So this
// deliberately uses getCategoryBySlug (active or not), not
// listActiveCategories.
export default async function CategoryPage({
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

  const category = await getCategoryBySlug(slugResult.data);
  if (!category) notFound();

  const [{ posts, hasMore }, categories] = await Promise.all([
    getCategoryFeed(slugResult.data, 0),
    listActiveCategories(),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">{category.name}</h1>

      {/* An inactive category won't appear in this pills row even while its
          own page keeps rendering — deactivation hides it from pickers/
          indexes, not from the public (FR-2.1, ADR-0017). Intended. */}
      <div className="mt-4">
        <CategoryPills categories={categories} activeSlug={slugResult.data} />
      </div>

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
              filter={{ kind: "category", slug: slugResult.data }}
            />
          </>
        )}
      </div>
    </main>
  );
}
