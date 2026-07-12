"use client";

import Link from "next/link";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { createComment } from "@/actions/comments";
import { CommentComposer } from "@/app/(public)/posts/[slug]/_components/comment-composer";
import {
  CommentsContext,
  type CommentsContextValue,
} from "@/app/(public)/posts/[slug]/_components/comments-context";
import { CommentThread } from "@/app/(public)/posts/[slug]/_components/comment-thread";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import type { CommentSubmitResult } from "@/lib/comments/submit-result";
import {
  countVisibleComments,
  insertCommentNode,
  updateCommentNode,
  type CommentNode,
} from "@/lib/comments/tree";

// Shape of GET /api/comments' JSON body (src/app/api/comments/route.ts).
// Declared locally rather than imported from src/lib/comments/service/
// read.ts: that module carries a `server-only` import, and this is a client
// component — the wire shape is duplicated on purpose to keep the
// client/server boundary honest (CommentNode itself is the one type
// legitimately shared, per its own module comment).
type CommentThreadResponse = {
  meta: { commentsLocked: boolean };
  comments: CommentNode[];
};

const COMMENTS_QUERY_KEY = (postId: string) => ["comments", postId] as const;

async function fetchCommentThread(
  postId: string,
): Promise<CommentThreadResponse> {
  const response = await fetch(`/api/comments?postId=${postId}`, {
    // Comment reads are deliberately uncached (design §3) — TanStack Query
    // owns freshness/refetching for this island, not the HTTP cache.
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load comments.");
  }
  return response.json();
}

// Module-singleton QueryClient (not created per-render/per-mount): comments
// are the ONE TanStack Query consumer in the app (design §1/§5.3), so this
// island owns its own client rather than a root-layout provider every other
// (non-comment) page would carry for nothing.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reads are already no-store at the fetch layer; refetch on every
      // mount/focus instead of trusting a stale in-memory cache across
      // separate post pages sharing this one singleton client.
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
});

// Island root (CMT-3): mounted after <PostArticle> in the (cached, "use
// cache") post page — a client-component reference serializes fine into
// that cached shell, and everything this renders is fetched fresh
// client-side (design §2 "cached shell + uncached interactive data").
export function CommentsSection({
  postId,
  postSlug,
}: {
  postId: string;
  postSlug: string;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <CommentsSectionInner postId={postId} postSlug={postSlug} />
    </QueryClientProvider>
  );
}

function CommentsSectionInner({
  postId,
  postSlug,
}: {
  postId: string;
  postSlug: string;
}) {
  const client = useQueryClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // A `locked`/`archived` denial from an in-flight submission means the
  // post's comment state changed after this page loaded (an admin locked
  // it, or it got archived) — sticks for the rest of this visit rather than
  // letting every further attempt fail the same way silently.
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: COMMENTS_QUERY_KEY(postId),
    queryFn: () => fetchCommentThread(postId),
  });

  function insertNode(parentId: string | null, node: CommentNode) {
    client.setQueryData<CommentThreadResponse>(
      COMMENTS_QUERY_KEY(postId),
      (old) =>
        old
          ? {
              ...old,
              comments: insertCommentNode(old.comments, parentId, node),
            }
          : old,
    );
  }

  function handleRootResult(result: CommentSubmitResult) {
    if (result.status === "visible") {
      insertNode(null, result.comment);
    } else if (
      result.status === "denied" &&
      (result.reason === "locked" || result.reason === "archived")
    ) {
      setLockMessage(result.message);
    }
  }

  const commentsLocked =
    lockMessage !== null || data?.meta.commentsLocked === true;
  const isBanned = !!session?.user.bannedAt;
  const canCompose = !!session && !isBanned && !commentsLocked;
  const canManageAny =
    !!session && canPerformAction(session.user, Action.ManageAnyComment);

  const contextValue: CommentsContextValue = {
    postId,
    currentUserId: session?.user.id ?? null,
    isBanned,
    canManageAny,
    canCompose,
    onCreated: insertNode,
    onEdited: (id, body, editedAt) => {
      client.setQueryData<CommentThreadResponse>(
        COMMENTS_QUERY_KEY(postId),
        (old) =>
          old
            ? {
                ...old,
                comments: updateCommentNode(old.comments, id, {
                  body,
                  editedAt,
                }),
              }
            : old,
      );
    },
    onDenialLock: setLockMessage,
    onNeedsRefetch: () => {
      client.invalidateQueries({ queryKey: COMMENTS_QUERY_KEY(postId) });
    },
  };

  const visibleCount = data ? countVisibleComments(data.comments) : null;

  return (
    <CommentsContext.Provider value={contextValue}>
      <section
        aria-labelledby="comments-heading"
        className="mt-10 flex flex-col gap-6 border-t pt-8"
      >
        <h2 id="comments-heading" className="text-xl font-bold tracking-tight">
          Comments{visibleCount !== null ? ` (${visibleCount})` : ""}
        </h2>

        {sessionPending ? (
          <Skeleton className="h-20 w-full" />
        ) : !session ? (
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/posts/${postSlug}`)}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Sign in
            </Link>{" "}
            to join the conversation.
          </p>
        ) : isBanned ? (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            You&rsquo;re banned from commenting.
          </p>
        ) : commentsLocked ? (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            {lockMessage ?? "Comments are locked on this post."}
          </p>
        ) : (
          <CommentComposer
            label="Add a comment"
            placeholder="Share your thoughts…"
            submitLabel="Post comment"
            pendingLabel="Posting…"
            onSubmit={(body) => createComment({ postId, parentId: null, body })}
            onResult={handleRootResult}
          />
        )}

        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-destructive"
          >
            <p>Couldn&rsquo;t load comments.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : data && data.comments.length > 0 ? (
          <CommentThread nodes={data.comments} depth={0} />
        ) : (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
      </section>
    </CommentsContext.Provider>
  );
}
