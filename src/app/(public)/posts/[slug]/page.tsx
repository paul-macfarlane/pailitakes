import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";

import { PostArticle } from "@/components/post-article";
import { deriveExcerpt } from "@/lib/content/excerpt";
import { renderMarkdown } from "@/lib/content/markdown";
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
  const post = await getRenderedPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: deriveExcerpt(post.bodyMd),
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
  cacheTag(`post:${slug}`);
  cacheLife({ stale: 60, revalidate: 60 });

  const post = await getRenderedPost(slug);
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
    </main>
  );
}
