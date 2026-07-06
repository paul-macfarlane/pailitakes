import "lite-youtube-embed/src/lite-yt-embed.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";

import { LiteYouTubeActivation } from "@/components/lite-youtube-activation";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { deriveExcerpt } from "@/lib/excerpt";
import { extractYouTubeId, renderMarkdown } from "@/lib/markdown";
import { getVisiblePostBySlug } from "@/lib/posts";

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

// UTC-pinned so the cached server render and any client render of the same
// date can never disagree across timezones.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

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

  const videoId = post.videoUrl ? extractYouTubeId(post.videoUrl) : null;
  // Fallback link only for http(s) URLs — video_url isn't write-validated
  // yet (admin epic), so never emit an arbitrary scheme into an href.
  const fallbackVideoHref =
    !videoId && post.videoUrl && /^https?:\/\//.test(post.videoUrl)
      ? post.videoUrl
      : null;
  if (post.videoUrl && !videoId) {
    // Don't swallow the miss (engineering rules): the reader gets a plain
    // link below and the log points at the unrecognized form.
    console.warn(
      `post ${slug}: video_url not recognized as a YouTube video, rendering plain link: ${post.videoUrl}`,
    );
  }
  const bodyHasEmbeds = post.bodyHtml.includes("<lite-youtube");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      {/* YouTubeEmbed brings its own activation; body embeds need one here. */}
      {!videoId && bodyHasEmbeds && <LiteYouTubeActivation />}
      <article>
        <header className="mb-6">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            {post.category.name}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            By {post.author.name}
            {post.publishAt && (
              <>
                {" · "}
                <time dateTime={post.publishAt.toISOString()}>
                  {dateFormat.format(post.publishAt)}
                </time>
              </>
            )}
          </p>
        </header>

        {videoId ? (
          <div className="mb-6">
            <YouTubeEmbed videoId={videoId} title={post.title} />
          </div>
        ) : (
          fallbackVideoHref && (
            <p className="mb-6 text-sm">
              <a
                href={fallbackVideoHref}
                rel="noopener noreferrer"
                target="_blank"
                className="text-muted-foreground underline hover:text-foreground"
              >
                Watch the video
              </a>
            </p>
          )
        )}

        <div
          className="prose dark:prose-invert max-w-none"
          // Sanitized by rehype-sanitize in renderMarkdown (design §5.1).
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />

        {post.tags.length > 0 && (
          <footer className="mt-8 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag.slug}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
          </footer>
        )}
      </article>
    </main>
  );
}
