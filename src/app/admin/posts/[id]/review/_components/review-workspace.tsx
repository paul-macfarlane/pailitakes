"use client";

import { useId, useRef, useState } from "react";

import {
  discardReviewDraft,
  refreshReviewDraft,
  saveReviewDraft,
  submitReview,
} from "@/actions/posts/reviews";
import { renderPostPreview } from "@/actions/preview";
import { ExactText } from "@/app/admin/posts/[id]/reviews/_components/review-content";
import { PostBody } from "@/components/post-body";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CORRECTION_EXPLANATION,
  REVIEW_TEXT_MAX,
  type DraftComment,
  type DraftSuggestion,
} from "@/lib/reviews/input";
import type { ReviewWorkspace as Workspace } from "@/lib/reviews/service";
import { overlapsSuggestion, rawOffset } from "@/lib/reviews/suggestions";
import { ActionErrorCode, GENERIC_ERROR } from "@/lib/shared/action-result";

type Range = { start: number; end: number };
type SuggestComposer = {
  kind: "suggest";
  range: Range;
  editingId: string | null;
  after: string;
  explanation: string;
  correction: boolean;
};
type Composer =
  SuggestComposer | { kind: "comment"; range: Range; body: string };
const Confirm = {
  Submit: "submit",
  Outdated: "outdated",
  Discard: "discard",
} as const;
type Confirm = (typeof Confirm)[keyof typeof Confirm];

const lineOf = (body: string, offset: number) =>
  body.slice(0, offset).split("\n").length;

// The reviewer selects in the draft's markdown source so every suggestion
// binds to exact saved text (Paul, September 27). Each change persists
// immediately with a revision check; nothing reaches the owner until submit.
export function ReviewWorkspace({
  postId,
  workspace,
}: {
  postId: string;
  workspace: Workspace;
}) {
  const { draft, outdated, previous } = workspace;
  const body = draft.base.bodyMd;
  const textareaId = useId();
  const feedbackId = useId();
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState(draft.suggestions);
  const [comments, setComments] = useState(draft.comments);
  const [feedback, setFeedback] = useState(draft.generalFeedback);
  const [savedFeedback, setSavedFeedback] = useState(draft.generalFeedback);
  const [selection, setSelection] = useState<Range | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Saves run one at a time against the latest saved state: leaving the
  // feedback box while a suggestion is still saving must not reuse a stale
  // revision (which the server would reject as another tab's edit).
  type Content = {
    suggestions: DraftSuggestion[];
    comments: DraftComment[];
    generalFeedback: string;
  };
  const saved = useRef({
    revision: draft.revision,
    content: {
      suggestions: draft.suggestions,
      comments: draft.comments,
      generalFeedback: draft.generalFeedback,
    } as Content,
  });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function persist(
    update: (current: Content) => Partial<Content>,
  ): Promise<number | null> {
    const run = async (): Promise<number | null> => {
      setPending(true);
      setError(null);
      const content = {
        ...saved.current.content,
        ...update(saved.current.content),
      };
      try {
        const result = await saveReviewDraft({
          postId,
          revision: saved.current.revision,
          ...content,
        });
        if (!result.ok) {
          if ("code" in result && result.code === ActionErrorCode.Conflict)
            setConflict(true);
          setError(result.error);
          return null;
        }
        saved.current = { revision: result.data.revision, content };
        setSuggestions(content.suggestions);
        setComments(content.comments);
        setSavedFeedback(content.generalFeedback);
        return result.data.revision;
      } catch {
        setError(GENERIC_ERROR);
        return null;
      } finally {
        setPending(false);
      }
    };
    const next = queue.current.then(run, run);
    queue.current = next;
    return next;
  }

  function captureSelection() {
    const el = sourceRef.current;
    if (!el) return;
    const range = {
      start: rawOffset(body, el.selectionStart),
      end: rawOffset(body, el.selectionEnd),
    };
    setSelection(range.end > range.start ? range : null);
  }

  function openSuggest(range: Range, seed?: Partial<SuggestComposer>) {
    if (overlapsSuggestion(suggestions, range, seed?.editingId ?? undefined)) {
      setError(
        "That text overlaps an existing suggestion. Edit that suggestion instead.",
      );
      return;
    }
    setError(null);
    setComposer({
      kind: "suggest",
      range,
      editingId: null,
      after: body.slice(range.start, range.end),
      explanation: "",
      correction: false,
      ...seed,
    });
  }

  async function saveComposer() {
    if (!composer) return;
    const { range } = composer;
    if (composer.kind === "comment") {
      const comment = {
        id: crypto.randomUUID(),
        ...range,
        quote: body.slice(range.start, range.end),
        body: composer.body.trim(),
      };
      const ok = await persist((current) => ({
        comments: [...current.comments, comment],
      }));
      if (ok !== null) setComposer(null);
      return;
    }
    const suggestion: DraftSuggestion = {
      id: composer.editingId ?? crypto.randomUUID(),
      ...range,
      before: body.slice(range.start, range.end),
      after: composer.after,
      correction: composer.correction,
      explanation: composer.correction ? "" : composer.explanation.trim(),
    };
    const ok = await persist((current) => ({
      suggestions: [
        ...current.suggestions.filter((s) => s.id !== suggestion.id),
        suggestion,
      ].sort((a, b) => a.start - b.start),
    }));
    if (ok !== null) setComposer(null);
  }

  async function doSubmit(acceptOutdated: boolean) {
    // Flush any queued save (and unsaved feedback) before submitting.
    const flushed = await persist(() =>
      feedback !== saved.current.content.generalFeedback
        ? { generalFeedback: feedback }
        : {},
    );
    if (flushed === null) return;
    setPending(true);
    setError(null);
    try {
      const result = await submitReview({
        postId,
        revision: flushed,
        acceptOutdated,
      });
      if (!result.ok) {
        if ("code" in result && result.code === ActionErrorCode.Outdated) {
          setConfirm(Confirm.Outdated);
          return;
        }
        if ("code" in result && result.code === ActionErrorCode.Conflict)
          setConflict(true);
        setError(result.error);
        setConfirm(null);
        return;
      }
      window.location.assign(
        `/admin/posts/${postId}/reviews/${result.data.proposalId}`,
      );
    } catch {
      setError(GENERIC_ERROR);
      setConfirm(null);
    } finally {
      setPending(false);
    }
  }
  async function doRefresh() {
    setPending(true);
    setError(null);
    try {
      await queue.current;
      const result = await refreshReviewDraft({
        postId,
        revision: saved.current.revision,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.reload();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  async function doDiscard() {
    setPending(true);
    try {
      const result = await discardReviewDraft(postId);
      if (!result.ok) {
        setError(result.error);
        setConfirm(null);
        return;
      }
      window.location.assign(`/admin/preview/${postId}`);
    } catch {
      setError(GENERIC_ERROR);
      setConfirm(null);
    } finally {
      setPending(false);
    }
  }

  async function togglePreview() {
    if (preview !== null) {
      setPreview(null);
      return;
    }
    setPending(true);
    try {
      const rendered = await renderPostPreview({ bodyMd: body });
      if (rendered.ok) setPreview(rendered.data.html);
      else setError(rendered.error);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  const selectionText = selection
    ? body.slice(selection.start, selection.end)
    : "";
  const composerValid =
    composer?.kind === "comment"
      ? composer.body.trim().length > 0
      : composer
        ? composer.after !==
            body.slice(composer.range.start, composer.range.end) &&
          (composer.correction || composer.explanation.trim().length > 0)
        : false;
  const hasContent =
    suggestions.length > 0 || comments.length > 0 || feedback.trim().length > 0;

  return (
    <div className="min-w-0 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Your review</h1>
        <p className="break-words text-lg">{draft.base.title}</p>
        <p className="text-sm text-muted-foreground">
          In progress · only you can see this until you submit. Submitting
          shares feedback with the owner; it isn&apos;t approval to publish.
        </p>
      </header>

      {outdated && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive p-4 text-sm"
        >
          <p>
            The post changed after you started this review. You can refresh it
            against the latest draft (your suggestions move to a re-add list so
            you can check each one), or submit as is: your feedback stays
            readable, but its edits can&apos;t be applied.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void doRefresh()}
          >
            Update review against latest draft
          </Button>
        </div>
      )}

      {conflict && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-4 text-sm"
        >
          This review changed in another tab.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>{" "}
          to continue.
        </p>
      )}

      {previous.length > 0 && (
        <section
          aria-labelledby="previous-heading"
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 id="previous-heading" className="text-lg font-semibold">
            Suggestions from your earlier review
          </h2>
          <p className="text-sm text-muted-foreground">
            Nothing is carried over automatically. Re-add what still applies;
            each one opens for you to confirm.
          </p>
          <ul className="space-y-3">
            {previous.map((item, index) => {
              const already = item.match
                ? suggestions.some(
                    (s) =>
                      s.start === item.match!.start &&
                      s.end === item.match!.end,
                  )
                : false;
              return (
                <li
                  key={index}
                  className="min-w-0 space-y-2 border-t pt-3 text-sm"
                >
                  <div className="grid min-w-0 gap-2 md:grid-cols-2">
                    <ExactText text={item.before} />
                    <ExactText text={item.after} />
                  </div>
                  <p className="whitespace-pre-wrap break-words">
                    {item.explanation}
                  </p>
                  {item.match ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">
                        Text still matches (line{" "}
                        {lineOf(body, item.match.start)}).
                      </span>
                      {!already && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            openSuggest(item.match!, {
                              after: item.after,
                              explanation: item.correction
                                ? ""
                                : item.explanation,
                              correction: item.correction,
                            })
                          }
                        >
                          Re-add
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      Text changed or appears more than once. Select it in the
                      draft to suggest again.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="draft-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="draft-heading" className="text-lg font-semibold">
            Draft
          </h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void togglePreview()}
          >
            {preview === null ? "Preview" : "Show markdown"}
          </Button>
        </div>
        {preview === null ? (
          <>
            <Label
              htmlFor={textareaId}
              className="text-sm font-normal text-muted-foreground"
            >
              Select text, then suggest a replacement or comment on it.
            </Label>
            <Textarea
              id={textareaId}
              ref={sourceRef}
              readOnly
              value={body}
              rows={14}
              className="font-mono text-sm"
              onSelect={captureSelection}
            />
            <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-sm">
              <Button
                size="sm"
                disabled={!selection || pending}
                onClick={() => selection && openSuggest(selection)}
              >
                Suggest edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!selection || pending}
                onClick={() =>
                  selection &&
                  setComposer({ kind: "comment", range: selection, body: "" })
                }
              >
                Comment
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {selection
                  ? `Selected: “${selectionText.slice(0, 40)}${selectionText.length > 40 ? "…" : ""}”`
                  : "Nothing selected"}
              </span>
            </div>
          </>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-lg border p-4">
            <PostBody html={preview} />
          </div>
        )}
      </section>

      {composer && (
        <section
          aria-label={
            composer.kind === "suggest" ? "Suggest an edit" : "Comment on text"
          }
          className="space-y-3 rounded-lg border p-4"
        >
          <h3 className="font-medium">
            {composer.kind === "suggest"
              ? composer.editingId
                ? "Edit suggestion"
                : "Suggest an edit"
              : "Comment on text"}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              (line {lineOf(body, composer.range.start)})
            </span>
          </h3>
          <div className="space-y-1">
            <p className="text-sm font-medium">Selected text</p>
            <ExactText
              text={body.slice(composer.range.start, composer.range.end)}
            />
          </div>
          {composer.kind === "suggest" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${textareaId}-after`}>Replace with</Label>
                <Textarea
                  id={`${textareaId}-after`}
                  value={composer.after}
                  rows={3}
                  onChange={(e) =>
                    setComposer({ ...composer, after: e.target.value })
                  }
                />
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={composer.correction}
                  onChange={(e) =>
                    setComposer({ ...composer, correction: e.target.checked })
                  }
                />
                Typo/formatting correction
              </label>
              {composer.correction ? (
                <p className="text-sm text-muted-foreground">
                  Explanation: “{CORRECTION_EXPLANATION}”
                </p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor={`${textareaId}-why`}>
                    Explain this change
                  </Label>
                  <Textarea
                    id={`${textareaId}-why`}
                    value={composer.explanation}
                    maxLength={REVIEW_TEXT_MAX}
                    rows={2}
                    onChange={(e) =>
                      setComposer({ ...composer, explanation: e.target.value })
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={`${textareaId}-comment`}>Comment</Label>
              <Textarea
                id={`${textareaId}-comment`}
                value={composer.body}
                maxLength={REVIEW_TEXT_MAX}
                rows={3}
                onChange={(e) =>
                  setComposer({ ...composer, body: e.target.value })
                }
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              disabled={!composerValid || pending}
              onClick={() => void saveComposer()}
            >
              {composer.kind === "suggest" ? "Save suggestion" : "Save comment"}
            </Button>
            <Button variant="ghost" onClick={() => setComposer(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="suggestions-heading" className="space-y-3">
        <h2 id="suggestions-heading" className="text-lg font-semibold">
          Suggested edits ({suggestions.length})
        </h2>
        {suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None yet. Feedback-only reviews are fine too.
          </p>
        )}
        {suggestions.map((s) => (
          <article
            key={s.id}
            aria-label={`Suggestion at line ${lineOf(body, s.start)}`}
            className="min-w-0 space-y-2 rounded-lg border p-4 text-sm"
          >
            <p className="text-xs text-muted-foreground">
              Line {lineOf(body, s.start)}
            </p>
            <div className="grid min-w-0 gap-2 md:grid-cols-2">
              <ExactText text={s.before} />
              <ExactText text={s.after} />
            </div>
            <p className="whitespace-pre-wrap break-words">
              {s.correction ? CORRECTION_EXPLANATION : s.explanation}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  setComposer({
                    kind: "suggest",
                    range: { start: s.start, end: s.end },
                    editingId: s.id,
                    after: s.after,
                    explanation: s.explanation,
                    correction: s.correction,
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  void persist((current) => ({
                    suggestions: current.suggestions.filter(
                      (x) => x.id !== s.id,
                    ),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="comments-heading" className="space-y-3">
        <h2 id="comments-heading" className="text-lg font-semibold">
          Comments on the text ({comments.length})
        </h2>
        {comments.map((c) => (
          <article
            key={c.id}
            aria-label={`Comment at line ${lineOf(body, c.start)}`}
            className="min-w-0 space-y-2 rounded-lg border p-4 text-sm"
          >
            <blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
              {c.quote}
            </blockquote>
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void persist((current) => ({
                  comments: current.comments.filter((x) => x.id !== c.id),
                }))
              }
            >
              Remove
            </Button>
          </article>
        ))}
      </section>

      <section className="space-y-2">
        <Label htmlFor={feedbackId} className="text-lg font-semibold">
          General feedback
        </Label>
        <Textarea
          id={feedbackId}
          value={feedback}
          maxLength={REVIEW_TEXT_MAX}
          rows={4}
          onChange={(e) => setFeedback(e.target.value)}
          onBlur={() => {
            if (feedback !== savedFeedback)
              void persist(() => ({ generalFeedback: feedback }));
          }}
        />
        <p className="text-xs text-muted-foreground">
          {feedback === savedFeedback
            ? "Saved"
            : "Saves when you leave this box"}
        </p>
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t pt-4">
        <Button
          disabled={pending || !hasContent || conflict}
          onClick={() => setConfirm(Confirm.Submit)}
        >
          Submit review
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => setConfirm(Confirm.Discard)}
        >
          Discard review
        </Button>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === Confirm.Discard
                ? "Discard this review?"
                : confirm === Confirm.Outdated
                  ? "Submit an outdated review?"
                  : "Submit review?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === Confirm.Discard
                ? "Your suggestions and comments will be deleted. The post isn't affected."
                : confirm === Confirm.Outdated
                  ? "The post changed after you started. Your feedback will be readable, but its suggested edits can't be applied. Update against the latest draft instead if you want them applied."
                  : `${suggestions.length} suggested edits and ${comments.length} comments will be shared with the post owner. This is feedback, not approval to publish.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant={confirm === Confirm.Discard ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                void (confirm === Confirm.Discard
                  ? doDiscard()
                  : doSubmit(confirm === Confirm.Outdated))
              }
            >
              {confirm === Confirm.Discard
                ? "Discard"
                : confirm === Confirm.Outdated
                  ? "Submit anyway"
                  : "Submit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
