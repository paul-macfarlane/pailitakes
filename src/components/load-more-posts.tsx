"use client";

import { useRef, useState } from "react";

import { PostCard } from "@/components/post-card";
import type { HomeFeedCard } from "@/lib/home-feed";

// Load-more island for the home feed (POST-7): appends pages from
// /api/posts. The first page is server-rendered; this only owns what came
// after a click. Offset pagination shifts when posts publish/unpublish
// between requests, so appends dedupe against every slug already on screen
// (prevents doubled cards and React key collisions; a shifted-past post
// simply waits for the next revalidation).
export function LoadMorePosts({
  initialSlugs,
  initialHasMore,
}: {
  initialSlugs: string[];
  initialHasMore: boolean;
}) {
  const [posts, setPosts] = useState<HomeFeedCard[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const seenSlugs = useRef(new Set(initialSlugs));
  const offset = useRef(initialSlugs.length);

  async function loadMore() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/posts?offset=${offset.current}`);
      if (!res.ok) throw new Error(`load-more failed: ${res.status}`);
      const page = (await res.json()) as {
        posts: HomeFeedCard[];
        hasMore: boolean;
      };
      const fresh = page.posts.filter((p) => !seenSlugs.current.has(p.slug));
      for (const p of fresh) seenSlugs.current.add(p.slug);
      offset.current += page.posts.length;
      setPosts((prev) => [...prev, ...fresh]);
      setHasMore(page.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {posts.map((post) => (
        <PostCard key={post.slug} post={post} />
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load more posts. Try again.
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mx-auto rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
