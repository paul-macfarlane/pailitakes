"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deletePost } from "@/actions/posts/crud";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Hard delete (ADM-4): unlike Archive (recoverable), this permanently
// removes the post row and, via FK cascade, its staged draft and tag links.
// Admins can hard-delete any post; authors can hard-delete only their own
// never-public, comment-free posts (ACCT-1's sibling feature) — the parent
// page only renders this for a post that's plausibly eligible, and the
// server action re-enforces the exact predicate regardless. No
// EditorFlushContext interaction — deleting discards any in-progress edits
// anyway, so there's nothing worth saving first.
export function PostDeleteControls({
  postId,
  postTitle,
}: {
  postId: string;
  postTitle: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deletePost(postId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // The row is gone, so this edit page would 404 on a refresh — push
        // to the dashboard instead of the sibling controls' router.refresh().
        router.push("/admin");
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-destructive">
          Danger zone
        </span>
        <p className="text-sm text-muted-foreground">
          Permanently delete this post. This cannot be undone.
        </p>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A refusal message belongs to the attempt it answered — reopening
          // the dialog later starts clean.
          if (!next) setError(null);
        }}
      >
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isPending}
              className="w-fit"
            />
          }
        >
          Delete post
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{postTitle}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the post and its staged changes. Unlike
              archiving, this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Refusals (e.g. the author-scoped predicate rejecting a stale
              page's delete) keep the dialog open, so the message must render
              INSIDE it — a page-level region sits behind the dialog overlay
              where the user can't see it. */}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={handleConfirm}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p
        aria-live="polite"
        role="status"
        className="text-sm text-muted-foreground"
      >
        {isPending ? "Deleting…" : ""}
      </p>
    </div>
  );
}
