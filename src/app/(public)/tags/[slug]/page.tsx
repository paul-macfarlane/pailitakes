import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FeedPagination } from "@/app/(public)/_components/feed-pagination";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTagFeed, HOME_PAGE_SIZE } from "@/lib/posts/home-feed";
import { slugParamSchema } from "@/lib/posts/input";
import { pageParamsSchema } from "@/lib/posts/search-params";
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

// Reads `?page=`, so the page itself can no longer carry a page-level
// "use cache" (that would pin the response to whatever page first built the
// static shell — ADR-0008 dynamic-params rule, same as home's searchParams
// section). The tag/page-dependent read lives in a Suspense boundary
// instead; the underlying feed DATA still caches on its own scope
// (getTagFeed's `use cache` + `post-list` tag, keyed by slug/offset), only
// this page-level shell/notFound computation is dynamic now.
export default function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<TagSkeleton />}>
      <TagSection params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TagSection({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, rawSearchParams] = await Promise.all([params, searchParams]);
  const slugResult = slugParamSchema.safeParse(slug);
  if (!slugResult.success) notFound();

  const tag = await getTagBySlug(slugResult.data);
  // notFound() fires inside this streamed Suspense boundary rather than
  // before the shell, so an unknown tag now returns 200-with-404-UI (a soft
  // 404) instead of a status-line 404 — accepted trade-off of making the
  // page page-aware, recorded in ADR-0019.
  if (!tag) notFound();

  const { page } = pageParamsSchema.parse(rawSearchParams);
  const { posts, hasMore } = await getTagFeed(
    slugResult.data,
    (page - 1) * HOME_PAGE_SIZE,
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Tagged &ldquo;{tag.name}&rdquo;
      </h1>

      <div className="mt-8 flex flex-col gap-6">
        {posts.length === 0 ? (
          <p className="text-muted-foreground">
            {page > 1 ? "No more posts." : "No posts yet."}
          </p>
        ) : (
          posts.map((post) => <PostCard key={post.slug} post={post} />)
        )}
        <FeedPagination
          pathname={`/tags/${slugResult.data}`}
          query={{}}
          page={page}
          hasMore={hasMore}
        />
      </div>
    </main>
  );
}

function TagSkeleton() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Skeleton className="h-8 w-64" />
      <div aria-busy="true" className="mt-8 flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-20 w-28 shrink-0 rounded-md sm:h-24 sm:w-36" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
