"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setCommentsLocked } from "@/actions/comments";
import { Button } from "@/components/ui/button";

// Admin-only comment lock toggle (CMT-8, FR-4.4). Deliberately separate from
// PostStatusControls/PostScheduleControls (a moderation control, not a
// lifecycle one) and from the editor's content autosave — toggling never
// flushes in-progress edits, mirroring setCommentsLocked's own
// no-revalidateTag design: lock state reaches readers via the uncached
// comments API meta, not ISR, so there's nothing here to invalidate either.
export function CommentLockToggle({
  postId,
  locked,
}: {
  postId: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setCommentsLocked(postId, !locked);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Comments</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
          {locked ? "Locked" : "Unlocked"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={handleToggle}
        >
          {locked ? "Unlock comments" : "Lock comments"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
