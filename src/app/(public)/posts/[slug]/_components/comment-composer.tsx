"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { CommentSubmitResult } from "@/lib/comments/submit-result";
import { cn } from "@/lib/utils";

// Mirrors src/lib/comments/input.ts's commentBodySchema limit — that module
// is server-safe zod but not marked for client import (CMT-3 spec fallback);
// duplicating one constant here is cheaper than pulling zod's validation
// path into this client bundle for a UI-only char counter (the server
// re-validates the real limit regardless).
const MAX_COMMENT_BODY = 2000;
// Counter only shows up once it's actually useful (near the limit) — see
// spec item 4 "char counter near the 2000 limit", not on every keystroke.
const COUNTER_THRESHOLD = 200;

// Shared create/reply/edit composer (CMT-3 item 8, CMT-7 item 9): agnostic
// of WHICH server action it calls or what parentId/commentId it targets —
// the caller supplies both the submit function and how to react to each
// CommentSubmitResult arm, so this component only owns textarea/counter/
// pending-state mechanics and the arm-specific inline notice.
export function CommentComposer({
  label,
  placeholder,
  initialValue = "",
  submitLabel = "Post",
  pendingLabel = "Posting…",
  onSubmit,
  onResult,
  onCancel,
  autoFocus,
}: {
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  pendingLabel?: string;
  onSubmit: (body: string) => Promise<CommentSubmitResult>;
  onResult: (result: CommentSubmitResult) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const body = value.trim();
    if (!body || isPending) return;

    setNotice(null);
    startTransition(async () => {
      let result: CommentSubmitResult;
      try {
        result = await onSubmit(body);
      } catch {
        result = {
          status: "error",
          message: "Something went wrong. Please try again.",
        };
      }

      // `visible`: the node now renders in the thread itself, so nothing to
      // say here — the caller (onResult) is what actually shows it.
      // `held`/`rejected`: final for this submission, clear the draft.
      // `denied`/`error`: keep the draft so a rate-limited or flaky
      // submission doesn't lose the user's typing.
      if (
        result.status === "visible" ||
        result.status === "held" ||
        result.status === "rejected"
      ) {
        setValue("");
      }
      if (result.status !== "visible") {
        setNotice(result.message);
      }
      onResult(result);
    });
  }

  const remaining = MAX_COMMENT_BODY - value.length;
  const showCounter = remaining <= COUNTER_THRESHOLD;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Field>
        {/* sr-only: placeholder carries the visible prompt so reply/edit
            boxes stay compact, but the control still has a real accessible
            name (engineering rules: labelled controls). */}
        <FieldLabel htmlFor={id} className="sr-only">
          {label}
        </FieldLabel>
        <Textarea
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          maxLength={MAX_COMMENT_BODY}
          disabled={isPending}
          autoFocus={autoFocus}
          rows={3}
        />
        {showCounter && (
          <FieldDescription className={cn(remaining < 0 && "text-destructive")}>
            {remaining} characters left
          </FieldDescription>
        )}
      </Field>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={isPending || value.trim().length === 0}
        >
          {isPending ? pendingLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
    </form>
  );
}
