import {
  ChangeKind,
  explanationTarget,
  type ProposalDiff,
} from "@/lib/proposals/diff";
import type { ProposalNotes, ProposalSnapshot } from "@/lib/proposals/input";
import {
  CORRECTION_EXPLANATION,
  ReviewStatus,
  type DraftComment,
  type DraftMetadataEdit,
  type DraftSuggestion,
  type PreviousSuggestion,
  type ReviewCommentAnchor,
} from "./input";

// Pure, client-safe rules for the human review workspace (ADR-0038).

type Range = { start: number; end: number };
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

// Anchors bind to exact text so a stale client or offset bug can't point a
// suggestion at the wrong words.
export function draftProblem(
  base: ProposalSnapshot,
  suggestions: DraftSuggestion[],
  comments: DraftComment[],
  metadata: DraftMetadataEdit[] = [],
): string | null {
  const bodyMd = base.bodyMd;
  for (const edit of metadata) {
    if (JSON.stringify(edit.after) === JSON.stringify(base[edit.field]))
      return "A detail suggestion matches the current value.";
  }
  if (new Set(metadata.map((edit) => edit.field)).size !== metadata.length)
    return "One suggestion per detail.";
  for (const s of suggestions) {
    if (bodyMd.slice(s.start, s.end) !== s.before)
      return "A suggestion no longer matches the reviewed text.";
  }
  for (const c of comments) {
    if (bodyMd.slice(c.start, c.end) !== c.quote)
      return "A comment no longer matches the reviewed text.";
  }
  const sorted = [...suggestions].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (overlaps(sorted[i - 1]!, sorted[i]!))
      return "Suggestions can't overlap. Edit the existing suggestion instead.";
  }
  const ids = [...suggestions, ...comments].map((item) => item.id);
  if (new Set(ids).size !== ids.length) return "Duplicate review item.";
  return null;
}

export function overlapsSuggestion(
  suggestions: DraftSuggestion[],
  range: Range,
  exceptId?: string,
): boolean {
  return suggestions.some((s) => s.id !== exceptId && overlaps(s, range));
}

export function suggestionExplanation(s: {
  correction: boolean;
  explanation: string;
}): string {
  return s.correction ? CORRECTION_EXPLANATION : s.explanation;
}

// Human reviews reuse the shared notes shape; AI-only sections stay empty.
export function humanReviewNotes(
  diff: ProposalDiff,
  suggestions: DraftSuggestion[],
  generalFeedback: string,
  metadata: DraftMetadataEdit[] = [],
): ProposalNotes {
  const byStart = new Map(suggestions.map((s) => [s.start, s]));
  const byField = new Map(metadata.map((edit) => [edit.field, edit]));
  return {
    summary: generalFeedback,
    changes: diff.changes.map((change) => {
      const suggestion =
        change.kind === ChangeKind.Body
          ? byStart.get(change.start)
          : byField.get(change.field);
      if (!suggestion) throw new Error("Change without a suggestion.");
      return {
        ...explanationTarget(change),
        explanation: suggestionExplanation(suggestion),
        sources: [],
      };
    }),
    editorial: [],
    facts: [],
    media: [],
  };
}

export function previousSuggestions(
  diff: ProposalDiff,
  notes: ProposalNotes,
): PreviousSuggestion[] {
  const explanations = new Map(
    notes.changes?.map((note) => [note.changeId, note.explanation]),
  );
  return diff.changes.map((change) => {
    const explanation = explanations.get(change.id) ?? "";
    const target = explanationTarget(change);
    return {
      ...(change.kind === ChangeKind.Metadata ? { field: change.field } : {}),
      before: target.before,
      after: target.after,
      explanation,
      correction: explanation === CORRECTION_EXPLANATION,
    };
  });
}

// Guided re-add hint for either kind of earlier suggestion: body text needs a
// unique exact match (its range is returned); a detail matches while its value
// is unchanged.
export function previousMatch(
  base: ProposalSnapshot,
  item: PreviousSuggestion,
): { stillMatches: boolean; range: { start: number; end: number } | null } {
  if (item.field)
    return {
      stillMatches: JSON.stringify(base[item.field]) === item.before,
      range: null,
    };
  const range = locatePrevious(base.bodyMd, item.before);
  return { stillMatches: range !== null, range };
}

// Editing a submitted review that is still current: rebuild the reviewer's
// draft exactly from the immutable review (same base, same anchors), so the
// resubmission replaces it rather than restarting (Paul, September 28).
export function draftFromReview(
  diff: ProposalDiff,
  notes: ProposalNotes,
  textComments: { anchor: ReviewCommentAnchor; body: string }[],
  newId: () => string,
): {
  suggestions: DraftSuggestion[];
  metadata: DraftMetadataEdit[];
  comments: DraftComment[];
  generalFeedback: string;
} {
  const explanations = new Map(
    notes.changes?.map((note) => [note.changeId, note.explanation]),
  );
  const suggestions: DraftSuggestion[] = [];
  const metadata: DraftMetadataEdit[] = [];
  for (const change of diff.changes) {
    const explanation = explanations.get(change.id) ?? "";
    const correction = explanation === CORRECTION_EXPLANATION;
    const why = correction ? "" : explanation;
    if (change.kind === ChangeKind.Body)
      suggestions.push({
        id: newId(),
        start: change.start,
        end: change.end,
        before: change.before,
        after: change.after,
        correction,
        explanation: why,
      });
    else
      metadata.push({
        field: change.field,
        after: change.after,
        correction,
        explanation: why,
      });
  }
  return {
    suggestions,
    metadata,
    comments: textComments.map((comment) => ({
      id: newId(),
      ...comment.anchor,
      body: comment.body,
    })),
    generalFeedback: notes.summary,
  };
}

// Guided re-add hint only: a unique exact match can be re-added with one
// confirmed click; anything else needs the reviewer to find the text.
// Nothing is carried forward automatically (FR-7.15).
export function locatePrevious(
  bodyMd: string,
  before: string,
): { start: number; end: number } | null {
  const first = bodyMd.indexOf(before);
  if (first === -1 || bodyMd.indexOf(before, first + 1) !== -1) return null;
  return { start: first, end: first + before.length };
}

// Per reviewer: an open draft wins; an outstanding request comes next; then
// an open submitted review. Closed reviews and no request show nothing.
export function reviewerStatus(input: {
  hasDraft: boolean;
  requestedAt: Date | null;
  latestReview: { createdAt: Date; open: boolean } | null;
}): ReviewStatus | null {
  if (input.hasDraft) return ReviewStatus.InProgress;
  const answered =
    input.latestReview !== null &&
    (input.requestedAt === null ||
      input.latestReview.createdAt >= input.requestedAt);
  if (input.requestedAt && !answered) return ReviewStatus.Requested;
  if (input.latestReview?.open) return ReviewStatus.Submitted;
  return null;
}

// The post's headline status for its owner: whatever needs attention first.
const STATUS_PRIORITY: ReviewStatus[] = [
  ReviewStatus.Submitted,
  ReviewStatus.InProgress,
  ReviewStatus.Requested,
];
export function headlineStatus(
  statuses: (ReviewStatus | null)[],
): ReviewStatus | null {
  return STATUS_PRIORITY.find((status) => statuses.includes(status)) ?? null;
}

// A <textarea> normalizes CRLF (and lone CR) to LF, so its selection offsets
// index the normalized text. Map them back to the raw saved body so anchors
// bind to the exact characters the reviewer selected.
export function rawOffset(body: string, normalized: number): number {
  let raw = 0;
  for (let seen = 0; seen < normalized && raw < body.length; seen++) {
    raw += body[raw] === "\r" && body[raw + 1] === "\n" ? 2 : 1;
  }
  return raw;
}
