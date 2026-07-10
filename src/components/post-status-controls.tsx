"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { transitionPostStatus } from "@/actions/posts";
import { Button } from "@/components/ui/button";
import {
  allowedTransitions,
  STATUS_LABELS,
  TRANSITION_LABELS,
  type PostStatus,
} from "@/lib/posts/status";
import { cn } from "@/lib/utils";

// Status badge + transition buttons for a saved post. Orthogonal to the
// editor's content autosave (transitionPostStatus touches only status +
// publish/archive timestamps), so the two islands coexist on the edit page.
export function PostStatusControls({
  postId,
  status,
  pendingChanges = false,
}: {
  postId: string;
  status: PostStatus;
  // Draft-of-published (ADR-0011): a public post with unpublished staged edits
  // can't change status until they're published or discarded (the server
  // rejects it too). Disable the buttons and say why.
  pendingChanges?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(target: PostStatus) {
    setError(null);
    // isPending stays true for the awaited action (buttons disabled while the
    // transition is in flight). router.refresh() then re-fetches the server
    // status; a stray click in the brief gap before that re-render is
    // harmless — transitionPostStatus is idempotent and CAS-guarded.
    startTransition(async () => {
      try {
        const result = await transitionPostStatus(postId, target);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Re-fetch the edit page's server data so the badge + available
        // transitions reflect the new status. The editor island keeps its
        // in-progress edits across a soft refresh.
        router.refresh();
      } catch {
        // A rejected RPC (network blip) must surface, not leave the controls
        // stuck disabled.
        setError("Something went wrong. Please try again.");
      }
    });
  }

  const busy = isPending || pendingChanges;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Status</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {allowedTransitions(status).map((target) => (
          <Button
            key={target}
            type="button"
            size="sm"
            variant={target === "published" ? "default" : "outline"}
            disabled={busy}
            onClick={() => handle(target)}
          >
            {TRANSITION_LABELS[target]}
          </Button>
        ))}
      </div>
      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={cn(
          "text-sm",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ??
          (pendingChanges
            ? "Publish or discard your pending changes first."
            : isPending
              ? "Updating…"
              : "")}
      </p>
    </div>
  );
}
