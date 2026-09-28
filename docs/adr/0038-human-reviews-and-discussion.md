# ADR-0038: Human reviews and review discussion

- **Status:** Accepted
- **Date:** 2026-09-28
- **Related:** COLLAB-3, COLLAB-4, FR-7.15–7.16, ADR-0030/0036/0037, technical-design.md §5.7 (updated)

## Context

COLLAB-2 gave collaborators access to a post. People still couldn't submit feedback: reviews were AI-only (origin `agent`, agent attribution and skill required, one open review per post). On September 27 Paul chose: body-text suggestions only; selection in the markdown source; outdated reviews may be submitted after a warning and updated through a guided re-add; thread resolution by owner/admin or the review's author.

## Decision

**Human reviews reuse the immutable review engine.** `edit_proposals` gains origin `human` with `reviewer_id` (set null on account deletion) and a `reviewer_name` snapshot. Agent attribution columns become nullable under a check constraint that still requires them for agent rows. The one-open rule is now scoped to agent reviews; any number of human reviews coexist with one open AI review. Apply, reject and stale checks are unchanged, so outdated human reviews stay readable but can't be applied.

**Each suggestion is exactly one change.** A human review's diff is built from the reviewer's selected ranges (`createRangeDiff`) rather than a line diff. A line diff could merge two suggestions on one line or split one suggestion. This way each explanation, comment and selective-apply checkbox binds to what the reviewer actually selected. Anchors are validated against the exact base text on every save and on submit.

**Drafts are private and mutable until submitted.** `review_drafts` holds one draft per reviewer per post: the base snapshot and source version captured at start, suggestions, text comments and general feedback. Saves use a revision compare-and-swap, so a second tab can't overwrite newer draft content. Submitting runs under the post lock. It writes the immutable review and its text comments, supersedes the reviewer's replaced review if one exists, and deletes the draft. Revoking a membership deletes that member's draft.

**Explanations are always present.** The typo/formatting shortcut is a reviewer choice that supplies a fixed explanation; nothing classifies edits automatically. General feedback is stored in the notes summary, so a feedback-only review is a review with no changes.

**Outdated reviews.** Submitting against an outdated draft requires explicit confirmation. "Update review against latest draft" starts a fresh draft beside the old review's suggestions, shown in a list with a hint on each: "text still matches" when the exact text appears exactly once in the new draft, otherwise "text changed". Each re-add is a reviewer-confirmed action; nothing is carried forward automatically. Refreshing an in-progress draft works the same way. A text comment keeps its anchor only if its quote still appears exactly once; otherwise it moves into general feedback with the quote attached.

**Discussion.** `review_comments` are plain-text staff comments attached to an immutable review. A comment is optionally tied to one change ID or to a quoted range of the review's base snapshot. Replies are one level deep, and resolution lives on the top-level comment; both limits are enforced by a database check. Anyone who can read the post can comment and reply. Owner/admin or the review's author can resolve or reopen a thread. Every read and write re-checks post access, so revoked collaborators lose the discussion immediately.

**Statuses are derived, not stored.** Review requested, Review in progress and Review submitted are computed per reviewer from `post_collaborators.review_requested_at`, the reviewer's draft, and their latest human review. The owner's dashboard shows the most actionable status across reviewers (submitted first).

## Consequences

The AI path is unchanged apart from its one-open rule being explicitly origin-scoped. Human reviews get the same apply/reject/stale safety as AI reviews. Any owner edit makes in-progress reviews outdated, which is conservative but visible, and the reviewer can refresh. Reviewer names persist in review history after account deletion. No email notifications, real-time co-editing or automatic carry-forward.
