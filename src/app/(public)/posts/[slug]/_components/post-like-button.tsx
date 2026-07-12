"use client";

import { ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

import { setPostLike } from "@/actions/likes";
import { LikeButton } from "@/app/(public)/posts/[slug]/_components/like-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";

type PostLikeState = { likeCount: number; likedByMe: boolean };

// Post-level like island (LIKE-3): mounted inside the cached post-page shell
// (page.tsx), same client-ref-in-"use cache" pattern as <CommentsSection>
// (comments-section.tsx:58-61). Design §5.4 keeps likes off TanStack Query —
// a plain fetch on mount is enough for this single GET (no shared cache to
// invalidate the way comments does).
export function PostLikeButton({ postId }: { postId: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [state, setState] = useState<PostLikeState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/likes?postId=${postId}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load like state.`);
        return response.json() as Promise<PostLikeState>;
      })
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch((error: unknown) => {
        // Errors are handled, not swallowed (engineering rules): a failed
        // read degrades to a disabled placeholder below rather than
        // silently rendering nothing.
        console.error("Failed to load post like state:", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (sessionPending || (!state && !failed)) {
    return <Skeleton className="h-7 w-14" />;
  }

  if (failed) {
    // No known liked/count state to seed LikeButton with, so this renders a
    // plain disabled thumbs-up with a muted "—" in place of a real count rather
    // than reusing LikeButton (which always has SOME real count to show).
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        aria-label="Like this post (unavailable)"
      >
        <ThumbsUp className="text-muted-foreground" />
        <span className="text-muted-foreground">—</span>
      </Button>
    );
  }

  if (!state) {
    // Unreachable in practice (the loading/failed branches above cover every
    // other case) — keeps the compiler's narrowing honest without a `!`
    // assertion on the fetched state below.
    return null;
  }

  return (
    <LikeButton
      likeCount={state.likeCount}
      likedByMe={state.likedByMe}
      signedIn={!!session}
      onSetLike={(liked) => setPostLike(postId, liked)}
      label="post"
      size="sm"
    />
  );
}
