"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { METADATA_FIELDS, type MetadataField } from "@/lib/proposals/diff";
import {
  proposalSnapshotSchema,
  type ProposalSnapshot,
} from "@/lib/proposals/input";
import {
  displayField,
  FIELD_LABELS,
  type ReviewCategory,
} from "@/lib/proposals/presentation";
import {
  CORRECTION_EXPLANATION,
  detailMessage,
  REVIEW_TEXT_MAX,
  type DraftComment,
  type DraftMetadataEdit,
  type DraftSuggestion,
} from "@/lib/reviews/input";
import type { ReviewWorkspace as Workspace } from "@/lib/reviews/service";
import { overlapsSuggestion, rawOffset } from "@/lib/reviews/suggestions";
import { ActionErrorCode, GENERIC_ERROR } from "@/lib/shared/action-result";

type Range = { start: number; end: number };
type Explained = { explanation: string; correction: boolean };
// Discriminants never leave this module.
type Composer =
  | ({
      kind: "suggest";
      range: Range;
      editingId: string | null;
      after: string;
    } & Explained)
  | { kind: "comment"; range: Range; body: string }
  | ({ kind: "detail"; field: MetadataField; value: string } & Explained);
type Content = {
  suggestions: DraftSuggestion[];
  comments: DraftComment[];
  metadata: DraftMetadataEdit[];
  generalFeedback: string;
};
const Confirm = {
  Submit: "submit",
  Outdated: "outdated",
  Discard: "discard",
} as const;
type Confirm = (typeof Confirm)[keyof typeof Confirm];

const lineOf = (body: string, offset: number) =>
  body.slice(0, offset).split("\n").length;

// Side-by-side from lg up; below that the composer is a bottom sheet so the
// draft stays in place (Paul, September 28).
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// Form text for a detail value, and back. Empty optional URLs mean "none".
function detailText(
  field: MetadataField,
  value: ProposalSnapshot[MetadataField],
) {
  if (field === "tags") return (value as string[]).join(", ");
  if (value === null) return "";
  return String(value);
}
function detailValue(field: MetadataField, text: string): unknown {
  if (field === "tags")
    return text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  if (field === "categoryId") return Number(text);
  if ((field === "bannerUrl" || field === "videoUrl") && !text.trim())
    return null;
  return text.trim();
}

// The reviewer selects in the draft's markdown source so every suggestion
// binds to exact saved text (Paul, September 27). Each change persists
// immediately with a revision check; nothing reaches the owner until submit.
export function ReviewWorkspace({
  postId,
  workspace,
  categories,
  activeCategoryIds,
}: {
  postId: string;
  workspace: Workspace;
  // All categories, for display names of current/historic values.
  categories: ReviewCategory[];
  // Suggestable ones, as in the editor; the current category stays listed.
  activeCategoryIds: number[];
}) {
  const { draft, outdated, previous } = workspace;
  const base = draft.base;
  const body = base.bodyMd;
  const wide = useWide();
  const textareaId = useId();
  const feedbackId = useId();
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState(draft.suggestions);
  const [comments, setComments] = useState(draft.comments);
  const [metadata, setMetadata] = useState(draft.metadata);
  const [feedback, setFeedback] = useState(draft.generalFeedback);
  const [savedFeedback, setSavedFeedback] = useState(draft.generalFeedback);
  const [selection, setSelection] = useState<Range | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Submit/discard failures show beside those buttons, which sit after the
  // item list on phones; editing errors stay by the article.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Saves run one at a time against the latest saved state: leaving the
  // feedback box while a suggestion is still saving must not reuse a stale
  // revision (which the server would reject as another tab's edit).
  const saved = useRef({
    revision: draft.revision,
    content: {
      suggestions: draft.suggestions,
      comments: draft.comments,
      metadata: draft.metadata,
      generalFeedback: draft.generalFeedback,
    } as Content,
  });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // `report` routes failures to where the user is looking: the composer
  // (which is a modal sheet on phones) or the article section.
  function persist(
    update: (current: Content) => Partial<Content>,
    report: (message: string | null) => void = setError,
  ): Promise<number | null> {
    const run = async (): Promise<number | null> => {
      setPending(true);
      report(null);
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
          report(result.error);
          return null;
        }
        saved.current = { revision: result.data.revision, content };
        setSuggestions(content.suggestions);
        setComments(content.comments);
        setMetadata(content.metadata);
        setSavedFeedback(content.generalFeedback);
        return result.data.revision;
      } catch {
        report(GENERIC_ERROR);
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

  function open(next: Composer) {
    setComposerError(null);
    setError(null);
    setComposer(next);
  }
  function openSuggest(
    range: Range,
    seed?: Partial<Explained & { after: string; editingId: string }>,
  ) {
    if (overlapsSuggestion(suggestions, range, seed?.editingId)) {
      setError(
        "That text overlaps an existing suggestion. Edit that suggestion instead.",
      );
      return;
    }
    open({
      kind: "suggest",
      range,
      editingId: seed?.editingId ?? null,
      after: seed?.after ?? body.slice(range.start, range.end),
      explanation: seed?.explanation ?? "",
      correction: seed?.correction ?? false,
    });
  }
  function openDetail(field: MetadataField, seed?: Partial<DraftMetadataEdit>) {
    open({
      kind: "detail",
      field,
      value: detailText(field, seed?.after ?? base[field]),
      explanation: seed?.explanation ?? "",
      correction: seed?.correction ?? false,
    });
  }

  async function saveComposer() {
    if (!composer) return;
    let update: (current: Content) => Partial<Content>;
    if (composer.kind === "comment") {
      const comment = {
        id: crypto.randomUUID(),
        ...composer.range,
        quote: body.slice(composer.range.start, composer.range.end),
        body: composer.body.trim(),
      };
      update = (current) => ({ comments: [...current.comments, comment] });
    } else if (composer.kind === "suggest") {
      const suggestion: DraftSuggestion = {
        id: composer.editingId ?? crypto.randomUUID(),
        ...composer.range,
        before: body.slice(composer.range.start, composer.range.end),
        after: composer.after,
        correction: composer.correction,
        explanation: composer.correction ? "" : composer.explanation.trim(),
      };
      update = (current) => ({
        suggestions: [
          ...current.suggestions.filter((s) => s.id !== suggestion.id),
          suggestion,
        ].sort((a, b) => a.start - b.start),
      });
    } else {
      const parsed = proposalSnapshotSchema.shape[composer.field].safeParse(
        detailValue(composer.field, composer.value),
      );
      if (!parsed.success) {
        setComposerError(detailMessage(composer.field));
        return;
      }
      const edit: DraftMetadataEdit = {
        field: composer.field,
        after: parsed.data as ProposalSnapshot[MetadataField],
        correction: composer.correction,
        explanation: composer.correction ? "" : composer.explanation.trim(),
      };
      update = (current) => ({
        metadata: [
          ...current.metadata.filter((m) => m.field !== edit.field),
          edit,
        ],
      });
    }
    if ((await persist(update, setComposerError)) !== null) setComposer(null);
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
    setSubmitError(null);
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
        setSubmitError(result.error);
        setConfirm(null);
        return;
      }
      window.location.assign(
        `/admin/posts/${postId}/reviews/${result.data.proposalId}`,
      );
    } catch {
      setSubmitError(GENERIC_ERROR);
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
        setSubmitError(result.error);
        setConfirm(null);
        return;
      }
      window.location.assign(`/admin/preview/${postId}`);
    } catch {
      setSubmitError(GENERIC_ERROR);
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
  const composerValid = !composer
    ? false
    : composer.kind === "comment"
      ? composer.body.trim().length > 0
      : (composer.correction || composer.explanation.trim().length > 0) &&
        (composer.kind === "suggest"
          ? composer.after !==
            body.slice(composer.range.start, composer.range.end)
          : JSON.stringify(detailValue(composer.field, composer.value)) !==
            JSON.stringify(base[composer.field]));
  const hasContent =
    suggestions.length > 0 ||
    metadata.length > 0 ||
    comments.length > 0 ||
    feedback.trim().length > 0;
  const suggestedDetail = new Map(metadata.map((m) => [m.field, m]));

  const composerPanel = composer && (
    <div className="space-y-3">
      {composer.kind !== "detail" ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Selected text{" "}
            <span className="font-normal text-muted-foreground">
              (line {lineOf(body, composer.range.start)})
            </span>
          </p>
          <ExactText
            text={body.slice(composer.range.start, composer.range.end)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-medium">Current value</p>
          <p className="rounded-md bg-muted p-3 text-sm break-words [overflow-wrap:anywhere]">
            {displayField(composer.field, base[composer.field], categories)}
          </p>
        </div>
      )}
      {composer.kind === "comment" && (
        <div className="space-y-1">
          <Label htmlFor={`${textareaId}-comment`}>Comment</Label>
          <Textarea
            id={`${textareaId}-comment`}
            value={composer.body}
            maxLength={REVIEW_TEXT_MAX}
            rows={3}
            onChange={(e) => setComposer({ ...composer, body: e.target.value })}
          />
        </div>
      )}
      {composer.kind === "suggest" && (
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
      )}
      {composer.kind === "detail" && (
        <div className="space-y-1">
          <Label htmlFor={`${textareaId}-detail`}>
            Suggested {FIELD_LABELS[composer.field].toLowerCase()}
          </Label>
          {composer.field === "categoryId" ? (
            // Native select: the category list is short and this keeps the
            // composer usable inside the mobile sheet without a popover.
            <select
              id={`${textareaId}-detail`}
              value={composer.value}
              onChange={(e) =>
                setComposer({ ...composer, value: e.target.value })
              }
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {categories
                .filter(
                  (category) =>
                    activeCategoryIds.includes(category.id) ||
                    category.id === base.categoryId,
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          ) : (
            <Input
              id={`${textareaId}-detail`}
              value={composer.value}
              onChange={(e) =>
                setComposer({ ...composer, value: e.target.value })
              }
            />
          )}
          {composer.field === "tags" && (
            <p className="text-xs text-muted-foreground">
              Separate tags with commas.
            </p>
          )}
          {(composer.field === "bannerUrl" ||
            composer.field === "videoUrl") && (
            <p className="text-xs text-muted-foreground">
              Leave empty to suggest removing it.
            </p>
          )}
        </div>
      )}
      {composer.kind !== "comment" && (
        <>
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
              <Label htmlFor={`${textareaId}-why`}>Explain this change</Label>
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
      )}
      {composerError && (
        <p role="alert" className="text-sm text-destructive">
          {composerError}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={!composerValid || pending}
          onClick={() => void saveComposer()}
        >
          {composer.kind === "comment" ? "Save comment" : "Save suggestion"}
        </Button>
        <Button variant="ghost" onClick={() => setComposer(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
  const composerTitle = !composer
    ? ""
    : composer.kind === "comment"
      ? "Comment on text"
      : composer.kind === "detail"
        ? `Suggest a ${FIELD_LABELS[composer.field].toLowerCase()}`
        : composer.editingId
          ? "Edit suggestion"
          : "Suggest an edit";

  return (
    <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Your review</h1>
          <p className="break-words text-lg">{base.title}</p>
          <p className="text-sm text-muted-foreground">
            In progress · only you can see this until you submit. Submitting
            shares feedback with the owner; it isn&apos;t approval to publish.
            {draft.replacesProposalId &&
              " You're editing a submitted review: it stays available to the owner until you resubmit."}
          </p>
          <a
            href={`/admin/preview/${postId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm underline"
          >
            Open full preview (new tab)
          </a>
        </header>

        {outdated && (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-destructive p-4 text-sm"
          >
            <p>
              The post changed after you started this review. You can refresh it
              against the latest draft (your suggestions move to a re-add list
              so you can check each one), or submit as is: your feedback stays
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

        <section aria-labelledby="details-heading" className="space-y-3">
          <h2 id="details-heading" className="text-lg font-semibold">
            Details
          </h2>
          <ul className="divide-y rounded-lg border">
            {METADATA_FIELDS.map((field) => {
              const suggested = suggestedDetail.get(field);
              return (
                <li
                  key={field}
                  className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{FIELD_LABELS[field]}</p>
                    <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                      {displayField(field, base[field], categories)}
                    </p>
                    {suggested && (
                      <p className="break-words [overflow-wrap:anywhere]">
                        → {displayField(field, suggested.after, categories)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      aria-label={`${suggested ? "Edit" : "Suggest"} ${FIELD_LABELS[field].toLowerCase()}`}
                      onClick={() => openDetail(field, suggested)}
                    >
                      {suggested ? "Edit" : "Suggest"}
                    </Button>
                    {suggested && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          void persist((current) => ({
                            metadata: current.metadata.filter(
                              (m) => m.field !== field,
                            ),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="draft-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="draft-heading" className="text-lg font-semibold">
              Article
            </h2>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void togglePreview()}
            >
              {preview === null ? "Formatted" : "Markdown"}
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
                className="font-mono text-sm lg:min-h-[60vh]"
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
                    open({ kind: "comment", range: selection, body: "" })
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
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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
      </div>

      <aside
        aria-label="Your suggestions and comments"
        className="mt-8 min-w-0 space-y-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1"
      >
        {wide && composer && (
          <section
            aria-label={composerTitle}
            className="space-y-3 rounded-lg border border-primary p-4"
          >
            <h2 className="font-semibold">{composerTitle}</h2>
            {composerPanel}
          </section>
        )}

        {previous.length > 0 && (
          <section
            aria-labelledby="previous-heading"
            className="space-y-3 rounded-lg border p-4"
          >
            <h2 id="previous-heading" className="font-semibold">
              From your earlier review
            </h2>
            <p className="text-sm text-muted-foreground">
              Nothing is carried over automatically. Re-add what still applies;
              each one opens for you to confirm.
            </p>
            <ul className="space-y-3">
              {previous.map((item, index) => {
                const detailAfter = item.field
                  ? (JSON.parse(item.after) as ProposalSnapshot[MetadataField])
                  : null;
                const readded = item.field
                  ? suggestedDetail.has(item.field)
                  : item.range !== null &&
                    suggestions.some(
                      (s) =>
                        s.start === item.range!.start &&
                        s.end === item.range!.end,
                    );
                return (
                  <li
                    key={index}
                    className="min-w-0 space-y-2 border-t pt-3 text-sm"
                  >
                    {item.field ? (
                      <p className="break-words [overflow-wrap:anywhere]">
                        <span className="font-medium">
                          {FIELD_LABELS[item.field]}:
                        </span>{" "}
                        {displayField(item.field, detailAfter!, categories)}
                      </p>
                    ) : (
                      <div className="grid min-w-0 gap-2">
                        <ExactText text={item.before} />
                        <ExactText text={item.after} />
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words">
                      {item.explanation}
                    </p>
                    {item.stillMatches ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">
                          {item.range
                            ? `Text still matches (line ${lineOf(body, item.range.start)}).`
                            : "Unchanged since your review."}
                        </span>
                        {!readded && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              item.field
                                ? openDetail(item.field, {
                                    after: detailAfter!,
                                    explanation: item.correction
                                      ? ""
                                      : item.explanation,
                                    correction: item.correction,
                                  })
                                : openSuggest(item.range!, {
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
                        {item.field
                          ? "This detail changed since your review."
                          : "Text changed or appears more than once. Select it in the article to suggest again."}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="suggestions-heading" className="space-y-3">
          <h2 id="suggestions-heading" className="font-semibold">
            Suggested edits ({suggestions.length + metadata.length})
          </h2>
          {suggestions.length + metadata.length === 0 && (
            <p className="text-sm text-muted-foreground">
              None yet. Feedback-only reviews are fine too.
            </p>
          )}
          {metadata.map((m) => (
            <article
              key={m.field}
              aria-label={`${FIELD_LABELS[m.field]} suggestion`}
              className="min-w-0 space-y-1 rounded-lg border p-3 text-sm"
            >
              <p className="font-medium">{FIELD_LABELS[m.field]}</p>
              <p className="break-words [overflow-wrap:anywhere]">
                {displayField(m.field, m.after, categories)}
              </p>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                {m.correction ? CORRECTION_EXPLANATION : m.explanation}
              </p>
            </article>
          ))}
          {suggestions.map((s) => (
            <article
              key={s.id}
              aria-label={`Suggestion at line ${lineOf(body, s.start)}`}
              className="min-w-0 space-y-2 rounded-lg border p-3 text-sm"
            >
              <p className="text-xs text-muted-foreground">
                Line {lineOf(body, s.start)}
              </p>
              <div className="grid min-w-0 gap-2">
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
                    openSuggest(
                      { start: s.start, end: s.end },
                      {
                        editingId: s.id,
                        after: s.after,
                        explanation: s.explanation,
                        correction: s.correction,
                      },
                    )
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
          <h2 id="comments-heading" className="font-semibold">
            Comments on the text ({comments.length})
          </h2>
          {comments.map((c) => (
            <article
              key={c.id}
              aria-label={`Comment at line ${lineOf(body, c.start)}`}
              className="min-w-0 space-y-2 rounded-lg border p-3 text-sm"
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
      </aside>

      {/* After the aside on phones (review your items, then submit); under
          the article on wide screens. */}
      <div className="mt-8 min-w-0 space-y-4 lg:col-start-1 lg:mt-8">
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap gap-3 border-t pt-4">
          <Button
            disabled={pending || !hasContent || conflict}
            onClick={() => setConfirm(Confirm.Submit)}
          >
            {draft.replacesProposalId ? "Resubmit review" : "Submit review"}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setConfirm(Confirm.Discard)}
          >
            {draft.replacesProposalId ? "Discard changes" : "Discard review"}
          </Button>
        </div>
      </div>

      <Sheet
        open={!wide && composer !== null}
        onOpenChange={(value) => {
          if (!value) setComposer(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{composerTitle}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">{composerPanel}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(value) => {
          if (!value && !pending) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === Confirm.Discard
                ? draft.replacesProposalId
                  ? "Discard your changes?"
                  : "Discard this review?"
                : confirm === Confirm.Outdated
                  ? "Submit an outdated review?"
                  : draft.replacesProposalId
                    ? "Resubmit review?"
                    : "Submit review?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === Confirm.Discard
                ? draft.replacesProposalId
                  ? "Your submitted review stays as it was. The post isn't affected."
                  : "Your suggestions and comments will be deleted. The post isn't affected."
                : confirm === Confirm.Outdated
                  ? "The post changed after you started. Your feedback will be readable, but its suggested edits can't be applied. Update against the latest draft instead if you want them applied."
                  : `${suggestions.length + metadata.length} suggested edits and ${comments.length} comments will be shared with the post owner${draft.replacesProposalId ? ", replacing your earlier version" : ""}. This is feedback, not approval to publish.`}
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
