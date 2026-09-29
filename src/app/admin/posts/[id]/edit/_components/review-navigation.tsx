"use client";

import { useContext, useState } from "react";
import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
import { Button } from "@/components/ui/button";

const Destination = {
  Reviews: "reviews",
  Sharing: "sharing",
  Review: "review",
} as const;
type Destination = (typeof Destination)[keyof typeof Destination];
const DESTINATION_LABELS: Record<Destination, string> = {
  [Destination.Reviews]: "reviews",
  [Destination.Sharing]: "sharing settings",
  [Destination.Review]: "your review",
};

export function ReviewNavigation({
  postId,
  hasReviews,
  canManageSharing,
  canReview,
}: {
  postId: string;
  hasReviews: boolean | null;
  canManageSharing: boolean;
  canReview: boolean;
}) {
  const editor = useContext(EditorFlushContext);
  const [pending, setPending] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(destination: Destination) {
    setPending(destination);
    setError(null);
    try {
      if (!editor || !(await editor.flush())) {
        setError(
          `Save your edits or resolve the save conflict before opening ${DESTINATION_LABELS[destination]}.`,
        );
        return;
      }
      // A full navigation retains beforeunload protection for keystrokes
      // typed while the save was in flight. Never suppress that warning.
      window.location.assign(`/admin/posts/${postId}/${destination}`);
    } catch {
      setError(
        `Couldn't open ${DESTINATION_LABELS[destination]}. Your writing is still here; try again.`,
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => void open(Destination.Reviews)}
          disabled={pending !== null}
        >
          {pending === Destination.Reviews ? "Saving…" : "Reviews"}
        </Button>
        {canManageSharing && (
          <Button
            variant="outline"
            onClick={() => void open(Destination.Sharing)}
            disabled={pending !== null}
          >
            {pending === Destination.Sharing ? "Saving…" : "Sharing"}
          </Button>
        )}
        {canReview && (
          <Button
            variant="outline"
            onClick={() => void open(Destination.Review)}
            disabled={pending !== null}
          >
            {pending === Destination.Review ? "Saving…" : "Your review"}
          </Button>
        )}
        {hasReviews && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            Reviews available
          </span>
        )}
        {hasReviews === null && (
          <span className="text-sm text-muted-foreground">
            Review status unavailable
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Compare suggestions and choose what to keep
        {canManageSharing ? ", or share this draft with another author" : ""}.
        Your edits save before you leave.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
