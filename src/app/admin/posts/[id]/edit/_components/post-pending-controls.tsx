"use client";

import {
  useContext,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { discardPostChanges, publishPostChanges } from "@/actions/posts/draft";
import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
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
  const flush = useContext(EditorFlushContext);

  // Hydration-safe mounted flag: draftUpdatedAt formats to the viewer's
  // timezone, which the server (UTC) can't match — render the time only after
  // mount (same idiom as PostScheduleControls).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    options?: { skipFlushGuard?: boolean },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const flushed = (await flush?.flush()) ?? true;
        // Discard is throwing the staged edits away regardless of whether
        // they saved cleanly, so a flush failure (e.g. a validation error
        // left in the form) must not block it. Publish needs the latest
        // edits actually saved first, so it still blocks on a failed flush.
        if (!flushed && !options?.skipFlushGuard) {
          setError(
            "Couldn't save your latest edits — fix any errors above and try again.",
          );
          return;
        }
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        // Both paths only reach here after an explicit publish/discard, and
        // both reload immediately below — suppress the editor's beforeunload
        // prompt so a still-dirty form (e.g. discard proceeding past a
        // failed flush) doesn't trip a native "leave site?" prompt right
        // after the user's own action.
        flush?.allowUnloadOnce();
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
          onClick={() =>
            run(() => discardPostChanges(postId), { skipFlushGuard: true })
          }
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
