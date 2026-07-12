"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveHeldComment, restoreRejectedComment } from "@/actions/comments";
import { Button } from "@/components/ui/button";
import { CommentStatus } from "@/lib/comments/status";

// Same useTransition + inline error + router.refresh() pattern as
// CategoryRowControls (src/app/admin/categories/_components/
// category-row-controls.tsx). Monitoring log, not an inbox (design §5.2) —
// held gets a single Approve action, rejected a single Restore action; a
// successful action moves the comment to `visible`, so it drops off this
// filtered list on refresh.
export function ModerationRowControls({
  id,
  status,
}: {
  id: string;
  status: typeof CommentStatus.Held | typeof CommentStatus.Rejected;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          // The CAS conflict message ("already resolved elsewhere") matters
          // here — it tells the admin why the click didn't take effect
          // rather than looking like a silent failure.
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === CommentStatus.Held ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => approveHeldComment(id))}
          >
            Approve
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => restoreRejectedComment(id))}
          >
            Restore
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
