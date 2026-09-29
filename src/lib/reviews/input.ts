import { z } from "zod";

// Human review workflow (FR-7.15–7.16, ADR-0038). Client-safe: the review
// workspace validates with the same schemas the server enforces.

export const ReviewStatus = {
  Requested: "requested",
  InProgress: "in_progress",
  Submitted: "submitted",
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  [ReviewStatus.Requested]: "Review requested",
  [ReviewStatus.InProgress]: "Review in progress",
  [ReviewStatus.Submitted]: "Review submitted",
};

// Reviewer-chosen, never inferred (Paul, September 20): the shortcut supplies
// this explanation so every suggestion stays understandable.
export const CORRECTION_EXPLANATION = "Typo or formatting correction.";

export const REVIEW_TEXT_MAX = 4000;
const reviewText = z.string().trim().min(1).max(REVIEW_TEXT_MAX);
const offset = z.number().int().min(0).max(1_000_000);

export const draftSuggestionSchema = z
  .object({
    id: z.uuid(),
    start: offset,
    end: offset,
    before: z.string().min(1).max(100_000),
    after: z.string().max(100_000),
    correction: z.boolean(),
    // Empty only for corrections; the shortcut's text is filled on submit.
    explanation: z.string().trim().max(REVIEW_TEXT_MAX),
  })
  .strict()
  .refine((s) => s.end > s.start, "Select text to replace.")
  .refine((s) => s.after !== s.before, "The replacement matches the original.")
  .refine(
    (s) => s.correction || s.explanation.length > 0,
    "Explain this change, or mark it as a typo/formatting correction.",
  );
export type DraftSuggestion = z.infer<typeof draftSuggestionSchema>;

export const draftCommentSchema = z
  .object({
    id: z.uuid(),
    start: offset,
    end: offset,
    quote: z.string().min(1).max(100_000),
    body: reviewText,
  })
  .strict()
  .refine((c) => c.end > c.start, "Select text to comment on.");
export type DraftComment = z.infer<typeof draftCommentSchema>;

// A suggestion from the review being updated, shown beside the fresh draft
// for guided re-adding. Never applied automatically.
export type PreviousSuggestion = {
  before: string;
  after: string;
  explanation: string;
  correction: boolean;
};

export const saveReviewDraftSchema = z
  .object({
    postId: z.uuid(),
    revision: z.number().int().min(0),
    suggestions: z.array(draftSuggestionSchema).max(200),
    comments: z.array(draftCommentSchema).max(200),
    generalFeedback: z.string().trim().max(REVIEW_TEXT_MAX),
  })
  .strict();
export type SaveReviewDraft = z.infer<typeof saveReviewDraftSchema>;

export const submitReviewSchema = z
  .object({
    postId: z.uuid(),
    revision: z.number().int().min(0),
    // The reviewer confirmed submitting against an outdated draft.
    acceptOutdated: z.boolean(),
  })
  .strict();

// Anchored to immutable review/change IDs, never to mutable editor text.
export const reviewCommentAnchorSchema = z
  .object({ start: offset, end: offset, quote: z.string().min(1) })
  .strict();
export type ReviewCommentAnchor = z.infer<typeof reviewCommentAnchorSchema>;

export const addReviewCommentSchema = z
  .object({
    proposalId: z.uuid(),
    changeId: z.string().min(1).max(80).nullable(),
    parentId: z.uuid().nullable(),
    body: reviewText,
  })
  .strict();

export const resolveThreadSchema = z
  .object({ commentId: z.uuid(), resolved: z.boolean() })
  .strict();
