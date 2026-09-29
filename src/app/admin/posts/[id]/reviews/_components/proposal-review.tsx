"use client";

import Link from "next/link";
import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { applyProposal, rejectProposal } from "@/actions/posts/proposals";
import { startReview } from "@/actions/posts/reviews";
import { renderPostPreview } from "@/actions/preview";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/local-date";
import { DateDisplay } from "@/lib/shared/datetime";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { ProposalRow } from "@/lib/proposals/data";
import { ProposalOrigin, ProposalStatus } from "@/lib/proposals/input";
import type { ReviewCommentRow } from "@/lib/reviews/data";
import { applyProposalSelection, ChangeKind } from "@/lib/proposals/diff";
import {
  displayField,
  FIELD_LABELS,
  PROPOSAL_STATUS_LABELS,
  reviewAttribution,
  type ReviewCategory,
} from "@/lib/proposals/presentation";
import { PostStatus } from "@/lib/posts/status";
import { ActionErrorCode, GENERIC_ERROR } from "@/lib/shared/action-result";
import {
  ExactText,
  ReviewNotes,
  SnapshotContent,
  SourceLink,
} from "./review-content";
import { ReviewDiscussion } from "./review-discussion";

export function ProposalReview({
  proposal,
  stale: initiallyStale,
  postStatus,
  publishAt,
  canDecide,
  canResolve,
  canUpdate,
  comments,
  categories,
}: {
  proposal: ProposalRow;
  stale: boolean;
  // Owner/admin only; post collaborators read reviews (ADR-0037).
  canDecide: boolean;
  // Owner/admin or this review's human author (ADR-0038).
  canResolve: boolean;
  // This viewer's own open human review: edit it, or update it if outdated.
  canUpdate: boolean;
  comments: ReviewCommentRow[];
  postStatus: string;
  publishAt: Date | null;
  categories: ReviewCategory[];
}) {
  const [status, setStatus] = useState(proposal.status);
  const [stale, setStale] = useState(initiallyStale);
  // Opt in to each suggestion. Closed reviews show the recorded decision.
  const form = useForm<{ selectedChangeIds: string[] }>({
    defaultValues: { selectedChangeIds: proposal.acceptedChangeIds ?? [] },
  });
  const { field: selection } = useController({
    control: form.control,
    name: "selectedChangeIds",
  });
  const selected = selection.value;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<"apply" | "reject" | null>(null);
  const [preview, setPreview] = useState<{ body: string; html: string } | null>(
    null,
  );
  const explanations = new Map(
    proposal.notes.changes?.map((note) => [note.changeId, note]),
  );
  const open = status === ProposalStatus.Open;
  const human = proposal.origin === ProposalOrigin.Human;
  // A human feedback-only review has nothing to apply: closing it is
  // acknowledgement, not rejection. AI notes-only reviews keep their copy.
  const feedbackOnly = human && proposal.diff.changes.length === 0;
  const topLevel = comments.filter((comment) => comment.parentId === null);
  const [updating, setUpdating] = useState(false);
  async function updateReview() {
    setUpdating(true);
    setError(null);
    try {
      const started = await startReview({
        postId: proposal.postId,
        replacesProposalId: proposal.id,
      });
      if (!started.ok) {
        setError(started.error);
        return;
      }
      window.location.assign(`/admin/posts/${proposal.postId}/review`);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setUpdating(false);
    }
  }
  const editable = open && canDecide && !stale && !pending;
  const result = applyProposalSelection(
    proposal.base,
    proposal.candidate,
    proposal.diff,
    selected,
  );
  const destination = proposal.sourceIsPublic
    ? "Selected changes will be saved privately as pending edits. Publish them separately from the editor."
    : postStatus === PostStatus.Scheduled
      ? "Selected changes will update the scheduled post. Its existing publication schedule stays in place."
      : "Selected changes will update the saved post without publishing it.";

  function choose(ids: string[]) {
    selection.onChange(ids);
    setPreview(null);
    setError(null);
  }
  async function previewSelection() {
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const rendered = await renderPostPreview({ bodyMd: result.bodyMd });
      if (!rendered.ok) {
        setError(rendered.error);
        return;
      }
      setPreview({ body: result.bodyMd, html: rendered.data.html });
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }
  async function decide() {
    if (!decision) return;
    setPending(true);
    setError(null);
    try {
      const response =
        decision === "apply"
          ? await applyProposal({
              proposalId: proposal.id,
              selectedChangeIds: selected,
            })
          : await rejectProposal(proposal.id);
      if (!response.ok) {
        const conflict =
          "code" in response && response.code === ActionErrorCode.Conflict;
        if (conflict) setStale(true);
        setError(
          conflict
            ? "This review can no longer be applied. The post or review changed; request a fresh review of the saved post."
            : response.error,
        );
        return;
      }
      setStatus(
        decision === "apply" ? ProposalStatus.Applied : ProposalStatus.Rejected,
      );
      form.reset({ selectedChangeIds: decision === "reject" ? [] : selected });
      setNotice(
        decision === "apply"
          ? proposal.sourceIsPublic
            ? "Changes saved as pending edits. Open the editor to publish them when ready."
            : "Selected changes saved."
          : feedbackOnly
            ? "Review closed. Its feedback stays in the review history."
            : "Review rejected. Your post was not changed.",
      );
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
      setDecision(null);
    }
  }

  return (
    <div className="min-w-0 space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Review suggestions</h1>
        <p className="break-words text-lg">{proposal.base.title}</p>
        <p className="text-sm text-muted-foreground">
          {PROPOSAL_STATUS_LABELS[status]} · {reviewAttribution(proposal)} ·{" "}
          <LocalDate
            iso={proposal.createdAt.toISOString()}
            display={DateDisplay.DateTime}
          />
        </p>
        {!human && (
          <p className="text-sm text-muted-foreground">
            Editorial brief: Paulitakes Editor
          </p>
        )}
        {open && stale && (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-destructive p-4 text-sm"
          >
            <p>
              This review is out of date. The post changed after it was written,
              so its suggestions can&apos;t be applied. Its feedback stays
              readable
              {canDecide ? ", and you can still reject it" : ""}.
            </p>
          </div>
        )}
        {open && !stale && (
          <p className="rounded-lg border bg-muted p-4 text-sm">
            {destination}
            {postStatus === PostStatus.Scheduled && publishAt && (
              <>
                {" "}
                Scheduled for{" "}
                <LocalDate
                  iso={publishAt.toISOString()}
                  display={DateDisplay.DateTime}
                />
                .
              </>
            )}
          </p>
        )}
        {!open && (
          <p className="text-sm text-muted-foreground">
            This is a retained review of an earlier snapshot. The saved post may
            have changed since.
          </p>
        )}
        {open && canUpdate && (
          <div className="space-y-2 rounded-lg border p-4 text-sm">
            <p>
              {stale
                ? "This is your review. Update it against the latest draft to make its edits applicable again."
                : "This is your review. Editing keeps this version available to the owner until you resubmit."}
            </p>
            <Button
              size="sm"
              disabled={updating}
              onClick={() => void updateReview()}
            >
              {updating
                ? "Opening…"
                : stale
                  ? "Update review against latest draft"
                  : "Edit review"}
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="rounded-lg border p-4">
            {notice}
          </p>
        )}
        <Link
          className="inline-block text-sm underline"
          href={`/admin/posts/${proposal.postId}/edit`}
        >
          {canDecide ? "Open editor" : "Open post"}
        </Link>
      </header>

      {human ? (
        <section aria-labelledby="feedback-heading" className="space-y-2">
          <h2 id="feedback-heading" className="text-xl font-semibold">
            General feedback
          </h2>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {proposal.notes.summary || "No general feedback."}
          </p>
        </section>
      ) : (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Editorial notes · {proposal.notes.facts.length} fact checks ·{" "}
            {proposal.notes.media.length} media suggestions
          </summary>
          <div className="mt-4">
            <ReviewNotes notes={proposal.notes} />
          </div>
        </details>
      )}

      <section aria-labelledby="changes-heading" className="space-y-4">
        <h2 id="changes-heading" className="text-xl font-semibold">
          Suggested changes
        </h2>
        <p className="text-sm text-muted-foreground">
          Select changes to keep. Applying closes this review and records
          unselected changes as rejected.
        </p>
        {proposal.diff.wholeBodyReplacement && (
          <p className="text-sm">
            This is a large rewrite. The body is offered as one complete
            replacement.
          </p>
        )}
        {proposal.diff.changes.length === 0 ? (
          <p>
            This review contains notes only, with no content changes to apply.
          </p>
        ) : (
          <>
            {open && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editable}
                  onClick={() => choose(proposal.diff.changes.map((c) => c.id))}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editable}
                  onClick={() => choose([])}
                >
                  Clear selection
                </Button>
              </div>
            )}
            {proposal.diff.changes.map((change, index) => {
              const explanation = explanations.get(change.id);
              const title =
                change.kind === ChangeKind.Body
                  ? `Body change ${index + 1}`
                  : FIELD_LABELS[change.field];
              return (
                <div
                  key={change.id}
                  className="min-w-0 space-y-3 rounded-lg border p-4"
                >
                  <label className="flex min-h-11 items-center gap-3 font-medium">
                    <input
                      type="checkbox"
                      name={selection.name}
                      ref={index === 0 ? selection.ref : undefined}
                      onBlur={selection.onBlur}
                      className="size-5 accent-primary"
                      checked={selected.includes(change.id)}
                      disabled={!editable}
                      onChange={(event) =>
                        choose(
                          event.target.checked
                            ? [...selected, change.id]
                            : selected.filter((id) => id !== change.id),
                        )
                      }
                    />
                    {title}
                    {!open && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {selected.includes(change.id)
                          ? "Applied"
                          : "Not applied"}
                      </span>
                    )}
                  </label>
                  {change.kind === ChangeKind.Body && (
                    <p className="text-xs text-muted-foreground">
                      At line{" "}
                      {
                        proposal.base.bodyMd.slice(0, change.start).split("\n")
                          .length
                      }{" "}
                      of the reviewed snapshot
                    </p>
                  )}
                  <div className="grid min-w-0 gap-4 md:grid-cols-2">
                    <div className="min-w-0">
                      <h3 className="mb-2 text-sm font-medium">Before</h3>
                      <ExactText
                        text={
                          change.kind === ChangeKind.Body
                            ? change.before
                            : displayField(
                                change.field,
                                change.before,
                                categories,
                              )
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="mb-2 text-sm font-medium">Suggested</h3>
                      <ExactText
                        text={
                          change.kind === ChangeKind.Body
                            ? change.after
                            : displayField(
                                change.field,
                                change.after,
                                categories,
                              )
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2 border-t pt-3 text-sm">
                    <h3 className="font-medium">Why this change</h3>
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {explanation?.explanation ??
                        "No explanation supplied for this change."}
                    </p>
                    {explanation && explanation.sources.length > 0 && (
                      <ul
                        aria-label="Sources for this change"
                        className="space-y-1"
                      >
                        {explanation.sources.map((source, i) => (
                          <li key={i}>
                            <SourceLink href={source}>{source}</SourceLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="border-t pt-3">
                    <ReviewDiscussion
                      proposalId={proposal.id}
                      comments={comments}
                      threads={topLevel.filter(
                        (comment) => comment.changeId === change.id,
                      )}
                      changeId={change.id}
                      canResolve={canResolve}
                      newThreadLabel={`Comment on ${title.toLowerCase()}`}
                      collapsed
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </section>

      {topLevel.some((comment) => comment.anchor !== null) && (
        <section aria-labelledby="text-comments-heading" className="space-y-3">
          <h2 id="text-comments-heading" className="text-xl font-semibold">
            Comments on the text
          </h2>
          <ReviewDiscussion
            proposalId={proposal.id}
            comments={comments}
            threads={topLevel.filter((comment) => comment.anchor !== null)}
            canResolve={canResolve}
          />
        </section>
      )}

      <section aria-labelledby="discussion-heading" className="space-y-3">
        <h2 id="discussion-heading" className="text-xl font-semibold">
          Discussion
        </h2>
        <ReviewDiscussion
          proposalId={proposal.id}
          comments={comments}
          threads={topLevel.filter(
            (comment) => comment.anchor === null && comment.changeId === null,
          )}
          changeId={null}
          canResolve={canResolve}
          newThreadLabel="Comment on this review"
          emptyText="No discussion yet."
        />
      </section>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Full comparison — all text and fields
        </summary>
        <div className="mt-4 grid min-w-0 gap-6 md:grid-cols-2">
          <section className="min-w-0 space-y-3">
            <h2 className="font-semibold">Reviewed snapshot</h2>
            <SnapshotContent snapshot={proposal.base} categories={categories} />
          </section>
          <section className="min-w-0 space-y-3">
            <h2 className="font-semibold">Complete suggestion</h2>
            <SnapshotContent
              snapshot={proposal.candidate}
              categories={categories}
            />
          </section>
        </div>
      </details>

      <section className="space-y-4" aria-labelledby="selected-heading">
        <h2 id="selected-heading" className="text-xl font-semibold">
          {open ? "Your selected result" : "Recorded result"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {selected.length} of {proposal.diff.changes.length} changes selected.
          Includes unchanged text and fields from the reviewed snapshot.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void previewSelection()}
        >
          Preview selected result
        </Button>
        <SnapshotContent
          snapshot={result}
          categories={categories}
          html={preview?.body === result.bodyMd ? preview.html : undefined}
        />
      </section>
      <div className="space-y-3 border-t pt-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {open && !canDecide && (
          <p className="text-sm text-muted-foreground">
            Only the post owner or an admin can apply or reject this review.
          </p>
        )}
        {open && canDecide && (
          <div className="flex flex-wrap gap-3">
            {!feedbackOnly && (
              <Button
                disabled={!editable || selected.length === 0}
                onClick={() => setDecision("apply")}
              >
                Apply selected changes
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDecision("reject")}
            >
              {feedbackOnly ? "Close review" : "Reject review"}
            </Button>
          </div>
        )}
      </div>
      <AlertDialog
        open={decision !== null}
        onOpenChange={(value) => {
          if (!value && !pending) setDecision(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision === "apply"
                ? "Apply selected changes?"
                : feedbackOnly
                  ? "Close this review?"
                  : "Reject this review?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decision === "apply"
                ? `${selected.length} changes will be applied and ${proposal.diff.changes.length - selected.length} rejected. ${destination}`
                : "Your post stays as it is. This review will close and remain in its history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {decision === "apply" &&
            proposal.sourceIsPublic &&
            selected.includes("field:slug") && (
              <p className="text-sm text-destructive">
                You selected a new slug. When published, the post’s URL will
                change and old links may stop working.
              </p>
            )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button disabled={pending} onClick={() => void decide()}>
              {pending
                ? "Saving…"
                : decision === "apply"
                  ? "Confirm apply"
                  : feedbackOnly
                    ? "Confirm close"
                    : "Confirm rejection"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
