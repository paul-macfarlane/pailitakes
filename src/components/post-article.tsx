import "lite-youtube-embed/src/lite-yt-embed.css";

import Link from "next/link";

import { ExternalImage } from "@/components/external-image";
import { LiteYouTubeActivation } from "@/components/lite-youtube-activation";
import { PostBody } from "@/components/post-body";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { postHeroSrc } from "@/lib/content/image-src";
import { extractYouTubeId } from "@/lib/content/markdown";
import { showsUpdatedDate } from "@/lib/posts/status";

// One source of truth for how a rendered post looks (hero, byline, video,
// body, tags) — the public post page and the ADM-7 admin preview both use it,
// so a preview is pixel-identical to what publishes. Presentational only: the
// caller fetches + renders markdown and provides the max-width wrapper.
export type PostArticleData = {
  slug: string;
  title: string;
  bodyHtml: string;
  videoUrl: string | null;
  // Null for a draft that has never had a publish date (preview only); the
  // byline date is simply omitted then.
  publishAt: Date | null;
  // Null unless the post's staged edits have been promoted since publishAt
  // (POST-10); see showsUpdatedDate for when this actually renders.
  contentUpdatedAt: Date | null;
  thumbnailUrl: string;
  bannerUrl: string | null;
  category: { slug: string; name: string };
  author: { name: string };
  tags: { slug: string; name: string }[];
};

// UTC-pinned so a cached server render and any client render of the same date
// can never disagree across timezones.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function PostArticle({ post }: { post: PostArticleData }) {
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
      `post ${post.slug}: video_url not recognized as a YouTube video, rendering plain link: ${post.videoUrl}`,
    );
  }
  const bodyHasEmbeds = post.bodyHtml.includes("<lite-youtube");
  const heroSrc = postHeroSrc(post);
  // showsUpdatedDate doesn't narrow post.contentUpdatedAt for the compiler
  // (it's a plain boolean predicate, not an inline null check) — a local
  // const lets the truthy check below narrow it instead of a `!` assertion.
  const updatedAt = showsUpdatedDate(post.publishAt, post.contentUpdatedAt)
    ? post.contentUpdatedAt
    : null;

  return (
    <>
      {/* YouTubeEmbed brings its own activation; body embeds need one here. */}
      {!videoId && bodyHasEmbeds && <LiteYouTubeActivation />}
      <article>
        {/* Hero above the title (POST-9): banner → thumbnail → none, derived
            in src/lib/image-src.ts. Decorative — the title follows. */}
        {heroSrc && (
          <div className="relative mb-6 aspect-[2/1] w-full overflow-hidden rounded-lg border">
            <ExternalImage src={heroSrc} priority />
          </div>
        )}
        <header className="mb-6">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            <Link
              href={`/categories/${post.category.slug}`}
              className="hover:underline"
            >
              {post.category.name}
            </Link>
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
            {updatedAt && (
              <>
                {" · Updated "}
                <time dateTime={updatedAt.toISOString()}>
                  {dateFormat.format(updatedAt)}
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

        <PostBody html={post.bodyHtml} />

        {post.tags.length > 0 && (
          <footer className="mt-8 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Link
                key={tag.slug}
                href={`/tags/${tag.slug}`}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {tag.name}
              </Link>
            ))}
          </footer>
        )}
      </article>
    </>
  );
}
