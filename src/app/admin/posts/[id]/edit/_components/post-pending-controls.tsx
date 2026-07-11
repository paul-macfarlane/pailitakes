"use client";

import { useState, useSyncExternalStore, useTransition } from "react";

import { discardPostChanges, publishPostChanges } from "@/actions/posts/draft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};

// ADR-0011. On success this does a FULL reload rather than router.refresh:
// publish and discard change what the live/pending content is, and the
// sibling PostEditor island initializes its form + refs from initialPost only
// on mount (a soft refresh would leave it showing stale, now-discarded values
// and re-staging an inconsistent buffer). A hard reload re-initializes the
// whole edit page from the server — the correct state after a resolve.
export function PostPendingControls({
  postId,
  draftUpdatedAt,
}: {
  postId: string;
  draftUpdatedAt: Date | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Hydration-safe mounted flag: draftUpdatedAt formats to the viewer's
  // timezone, which the server (UTC) can't match — render the time only after
  // mount (same idiom as PostScheduleControls).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        window.location.reload();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Unpublished changes</span>
        <span className="text-sm text-muted-foreground">
          Your edits are saved as a draft and aren’t live yet
          {mounted && draftUpdatedAt
            ? ` (last saved ${draftUpdatedAt.toLocaleString()})`
            : ""}
          . Publish them to update the public post, or discard to keep the
          current version.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => run(() => publishPostChanges(postId))}
        >
          Publish changes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run(() => discardPostChanges(postId))}
        >
          Discard changes
        </Button>
      </div>
      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={cn(
          "text-sm",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? (isPending ? "Working…" : "")}
      </p>
    </div>
  );
}
