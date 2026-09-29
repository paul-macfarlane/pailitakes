"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startReview } from "@/actions/posts/reviews";
import { Button } from "@/components/ui/button";
import { GENERIC_ERROR } from "@/lib/shared/action-result";

export function StartReviewButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const result = await startReview({
                postId,
                replacesProposalId: null,
              });
              if (!result.ok) setError(result.error);
              else router.refresh();
            } catch {
              setError(GENERIC_ERROR);
            }
          })
        }
      >
        {pending ? "Starting…" : "Start review"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
