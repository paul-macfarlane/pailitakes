"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { addReviewComment, setThreadResolved } from "@/actions/posts/reviews";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewCommentRow } from "@/lib/reviews/data";
import { REVIEW_TEXT_MAX } from "@/lib/reviews/input";
import { GENERIC_ERROR } from "@/lib/shared/action-result";
import { DateDisplay } from "@/lib/shared/datetime";

// Plain-text staff discussion anchored to an immutable review/change (FR-7.16).
// React escapes the text; no markdown or links are rendered.

function CommentForm({
  label,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          if (await onSubmit(body)) setBody("");
        });
      }}
    >
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Textarea
        id={id}
        value={body}
        maxLength={REVIEW_TEXT_MAX}
        rows={2}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function CommentBody({ comment }: { comment: ReviewCommentRow }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {comment.authorName}
        </span>{" "}
        ·{" "}
        <LocalDate
          iso={comment.createdAt.toISOString()}
          display={DateDisplay.DateTime}
        />
      </p>
      <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
        {comment.body}
      </p>
    </div>
  );
}

export function ReviewDiscussion({
  proposalId,
  comments,
  threads,
  changeId,
  canResolve,
  newThreadLabel,
  emptyText,
  collapsed = false,
}: {
  proposalId: string;
  // Every comment on the review; replies are matched to `threads` by parent.
  comments: ReviewCommentRow[];
  threads: ReviewCommentRow[];
  // Where a new thread attaches: a change, or null for the whole review.
  // Omit to disallow new threads here (e.g. quoted-text threads).
  changeId?: string | null;
  canResolve: boolean;
  newThreadLabel?: string;
  emptyText?: string;
  // Hide the new-thread form behind a button (per-suggestion threads).
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [composing, setComposing] = useState(!collapsed);
  const [pending, startTransition] = useTransition();

  async function post(input: {
    changeId: string | null;
    parentId: string | null;
    body: string;
  }) {
    setError(null);
    try {
      const result = await addReviewComment({ proposalId, ...input });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setReplyingTo(null);
      router.refresh();
      return true;
    } catch {
      setError(GENERIC_ERROR);
      return false;
    }
  }
  function resolve(commentId: string, resolved: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setThreadResolved({ commentId, resolved });
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <div className="space-y-3">
      {threads.length === 0 && emptyText && (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
      {threads.map((thread) => {
        const replies = comments.filter((c) => c.parentId === thread.id);
        const resolved = thread.resolvedAt !== null;
        return (
          <article
            key={thread.id}
            aria-label={`Comment from ${thread.authorName}`}
            className="space-y-3 rounded-md border bg-muted/40 p-3"
          >
            {thread.anchor && (
              <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
                {thread.anchor.quote}
              </blockquote>
            )}
            {resolved ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Resolved · {thread.authorName}: {thread.body.slice(0, 60)}
                  {thread.body.length > 60 ? "…" : ""}
                </summary>
                <div className="mt-3 space-y-3">
                  <CommentBody comment={thread} />
                  {replies.map((reply) => (
                    <div key={reply.id} className="border-l pl-3">
                      <CommentBody comment={reply} />
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <>
                <CommentBody comment={thread} />
                {replies.map((reply) => (
                  <div key={reply.id} className="border-l pl-3">
                    <CommentBody comment={reply} />
                  </div>
                ))}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {!resolved && replyingTo !== thread.id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReplyingTo(thread.id)}
                >
                  Reply
                </Button>
              )}
              {canResolve && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => resolve(thread.id, !resolved)}
                >
                  {resolved ? "Reopen" : "Resolve"}
                </Button>
              )}
            </div>
            {replyingTo === thread.id && (
              <CommentForm
                label="Reply"
                submitLabel="Post reply"
                onCancel={() => setReplyingTo(null)}
                onSubmit={(body) =>
                  post({ changeId: null, parentId: thread.id, body })
                }
              />
            )}
          </article>
        );
      })}
      {changeId !== undefined &&
        newThreadLabel &&
        (composing ? (
          <CommentForm
            label={newThreadLabel}
            submitLabel="Comment"
            onCancel={collapsed ? () => setComposing(false) : undefined}
            onSubmit={async (body) => {
              const ok = await post({ changeId, parentId: null, body });
              if (ok && collapsed) setComposing(false);
              return ok;
            }}
          />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setComposing(true)}>
            {newThreadLabel}
          </Button>
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
