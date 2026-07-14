import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";

import { CommentsSection } from "@/app/(public)/posts/[slug]/_components/comments-section";
import { PostLikeButton } from "@/app/(public)/posts/[slug]/_components/post-like-button";
import { PostArticle } from "@/components/post-article";
import { ViewBeacon } from "@/components/view-beacon";
import { deriveExcerpt } from "@/lib/content/excerpt";
import { renderMarkdown } from "@/lib/content/markdown";
import { slugParamSchema } from "@/lib/posts/input";
import { getVisiblePostBySlug } from "@/lib/posts/posts";

// Cached per slug (design §3): tag `post:{slug}` for on-demand invalidation
// from publish/edit/archive actions and the revalidation cron; 60s
// background revalidation is the scheduled-publish safety net. Markdown
// renders inside the cached scope, so it runs once per revalidation, not per
// request (design §5.1).
async function getRenderedPost(slug: string) {
  "use cache";
  cacheTag(`post:${slug}`);
  cacheLife({ stale: 60, revalidate: 60 });

  const post = await getVisiblePostBySlug(slug);
  if (!post) return null;
  return { ...post, bodyHtml: await renderMarkdown(post.bodyMd) };
}

// Pages render on first request and then serve from cache (classic ISR
// fill-on-demand). Cache Components requires generateStaticParams to return
// at least one param set for build-time validation — CI builds against an
// empty database, so a never-linked placeholder (renders 404) stands in
// rather than querying for real slugs.
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

  const post = await getRenderedPost(slugResult.data);
  if (!post) return {};

  const description = deriveExcerpt(post.bodyMd);
  return {
    title: post.title,
    description,
    alternates: { canonical: `/posts/${post.slug}` },
    // Next merges metadata shallowly per top-level key, so defining
    // openGraph here replaces the root layout's object entirely — siteName
    // and locale must be restated (design §5.8).
    openGraph: {
      siteName: "Paulitakes",
      locale: "en_US",
      type: "article",
      title: post.title,
      description,
      url: `/posts/${post.slug}`,
      publishedTime: post.publishAt.toISOString(),
      modifiedTime: post.contentUpdatedAt?.toISOString(),
      section: post.category.name,
      tags: post.tags.map((tag) => tag.name),
      images: [{ url: post.thumbnailUrl, alt: post.title }],
    },
  };
}

// The whole page render is cached per slug ("use cache" on the component):
// classic ISR semantics — the 404 status for a missing/unpublished slug is
// computed before anything streams (a Suspense-wrapped article would commit
// a 200 shell first), and the article HTML serves straight from cache.
export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  "use cache";
  const { slug } = await params;
  const slugResult = slugParamSchema.safeParse(slug);
  if (!slugResult.success) notFound();

  cacheTag(`post:${slugResult.data}`);
  cacheLife({ stale: 60, revalidate: 60 });

  const post = await getRenderedPost(slugResult.data);
  if (!post) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      {/* Reader's way back to the post list (the home feed) — mirrors the
          admin editor's "← Posts". Lives here, not in PostArticle, which the
          admin preview also renders. */}
      <Link
        href="/"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← All posts
      </Link>
      <PostArticle post={post} />
      {/* Client-ref-in-"use cache" island (LIKE-3), same pattern as
          <CommentsSection> just below — footer area of the article, before
          comments. */}
      <div className="mt-4 border-t pt-4">
        <PostLikeButton postId={post.id} />
      </div>
      <CommentsSection postId={post.id} postSlug={slugResult.data} />
      {/* Client-ref-in-"use cache" island, same pattern as PostLikeButton
          above — placed last so it never affects layout. */}
      <ViewBeacon path={`/posts/${slugResult.data}`} postId={post.id} />
    </main>
  );
}
