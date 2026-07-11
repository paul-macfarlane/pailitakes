import Link from "next/link";

import { ExternalImage } from "@/components/external-image";
import type { HomeFeedCard } from "@/lib/posts/home-feed";

// UTC-pinned: server-rendered results must show the same date regardless of
// viewer timezone.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

// Presentational card (FR-9.x home feed): shared by home's three modes,
// category/tag browse, and /tags/[slug] — all server-rendered, paginated by
// URL (`?page=`, FeedPagination) rather than client-appended.
export function PostCard({ post }: { post: HomeFeedCard }) {
  return (
    <article className="flex gap-4">
      {/* Duplicate of the title link with no text of its own: hidden from
          the accessibility tree and tab order rather than given a name that
          screen readers would announce twice. */}
      <Link
        href={`/posts/${post.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block h-20 w-28 shrink-0 overflow-hidden rounded-md border sm:h-24 sm:w-36"
      >
        <ExternalImage src={post.thumbnailUrl} />
      </Link>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          <Link
            href={`/?category=${post.category.slug}`}
            className="hover:underline"
          >
            {post.category.name}
          </Link>
        </p>
        <h2 className="mt-0.5 font-semibold leading-snug">
          <Link href={`/posts/${post.slug}`} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {post.excerpt}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {post.author.name} ·{" "}
          <time dateTime={post.publishAt}>
            {dateFormat.format(new Date(post.publishAt))}
          </time>
        </p>
      </div>
    </article>
  );
}
