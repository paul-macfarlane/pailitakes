import "server-only";
import type { StaffSession } from "@/lib/auth/guards";
import {
  includesAccess,
  PostAccess,
  type PostActor,
} from "@/lib/collaboration/permissions";
import { postForSharing } from "@/lib/collaboration/data";
import { resolvePostAccess } from "@/lib/collaboration/service";
import { loadPostForUpdate, type Tx } from "@/lib/posts/data";
import { postDraftSchema } from "@/lib/posts/input";
import { isPubliclyVisible, PUBLIC_STATUSES } from "@/lib/posts/status";
import { createRangeDiff } from "@/lib/proposals/diff";
import {
  closeProposal,
  insertProposal,
  loadSnapshots,
  snapshotReferencesValid,
  withLockedSource,
} from "@/lib/proposals/data";
import {
  ProposalOrigin,
  ProposalStatus,
  proposalSnapshotSchema,
} from "@/lib/proposals/input";
import {
  ActionErrorCode,
  CONFLICT_RESULT,
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import {
  deleteDraft,
  displayName,
  findCommentContext,
  findDraft,
  findOwnOpenReview,
  findProposalContext,
  insertComment,
  insertComments,
  insertDraft,
  listComments,
  replaceDraft,
  setThreadResolved,
  writeDraftContent,
  type ReviewDraftRow,
} from "./data";
import {
  REVIEW_TEXT_MAX,
  type DraftComment,
  type PreviousSuggestion,
  type SaveReviewDraft,
} from "./input";
import {
  draftFromReview,
  draftProblem,
  humanReviewNotes,
  locatePrevious,
  previousMatch,
  previousSuggestions,
} from "./suggestions";

// Human review workflow (FR-7.15–7.16, ADR-0038). Every entry point checks
// post access for the CURRENT request: drafts, comments and statuses grant
// nothing on their own once membership is revoked.

const NOT_FOUND = { ok: false, error: "Review or post not found." } as const;
const denied = { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
export const OUTDATED_RESULT = {
  ok: false,
  code: ActionErrorCode.Outdated,
  error: "The draft changed since you started this review.",
} as const;

function failure(
  operation: string,
  context: { postId?: string; proposalId?: string; commentId?: string },
  error: unknown,
): ActionResult<never> {
  // Drafts and comments are private writing; log ids and the error class,
  // never contents or query parameters.
  console.error(`${operation} failed`, {
    ...context,
    error: error instanceof Error ? error.name : "unknown",
  });
  return { ok: false, error: GENERIC_ERROR };
}

type PostRef = { id: string; authorId: string };

// Anyone who can read the post may review it, except its owner.
async function mayReview(actor: PostActor, post: PostRef, tx?: Tx) {
  if (actor.id === post.authorId) return false;
  return includesAccess(
    await resolvePostAccess(actor, post, tx),
    PostAccess.Read,
  );
}

async function reviewablePost(actor: PostActor, postId: string) {
  const post = await loadPostForUpdate(postId);
  if (!post) return null;
  const ref = { id: postId, authorId: post.authorId };
  return (await mayReview(actor, ref)) ? post : null;
}

export async function startReviewService(
  session: StaffSession,
  postId: string,
  replacesProposalId: string | null,
): Promise<ActionResult<{ postId: string }>> {
  try {
    return (
      (await withLockedSource<ActionResult<{ postId: string }>>(
        postId,
        async (tx, post) => {
          const actor = session.user;
          if (
            !(await mayReview(
              actor,
              { id: postId, authorId: post.authorId },
              tx,
            ))
          )
            return NOT_FOUND;
          const existing = await findDraft(postId, actor.id, tx, true);
          if (replacesProposalId) {
            const replaced = await findOwnOpenReview(
              tx,
              replacesProposalId,
              postId,
              actor.id,
            );
            if (!replaced) return NOT_FOUND;
            // Already updating this review (e.g. a second click): continue it.
            if (existing?.replacesProposalId === replacesProposalId)
              return { ok: true, data: { postId } };
            // One in-progress review per reviewer: finish or discard it first.
            if (existing)
              return {
                ok: false,
                error:
                  "Finish or discard your review in progress before updating this one.",
              };
            const current =
              replaced.sourceVersion === post.editVersion &&
              replaced.sourceIsPublic === isPubliclyVisible(post);
            if (current) {
              // Still current: reopen it as an editable draft on the same
              // base. The submitted version stays live (the owner may still
              // apply it) until the resubmission replaces it.
              const ownTextComments = (
                await listComments(replaced.id, tx)
              ).flatMap((c) =>
                c.anchor && c.parentId === null && c.authorId === actor.id
                  ? [{ anchor: c.anchor, body: c.body }]
                  : [],
              );
              await insertDraft(tx, {
                postId,
                reviewerId: actor.id,
                sourceVersion: replaced.sourceVersion,
                sourceIsPublic: replaced.sourceIsPublic,
                base: replaced.base,
                ...draftFromReview(
                  replaced.diff,
                  replaced.notes,
                  ownTextComments,
                  () => crypto.randomUUID(),
                ),
                replacesProposalId,
              });
              return { ok: true, data: { postId } };
            }
            // Outdated: a fresh draft beside the old suggestions for guided
            // re-adding; nothing is carried forward automatically.
            const { effective } = await loadSnapshots(tx, postId, post);
            await insertDraft(tx, {
              postId,
              reviewerId: actor.id,
              sourceVersion: post.editVersion,
              sourceIsPublic: isPubliclyVisible(post),
              base: proposalSnapshotSchema.parse(effective),
              previous: previousSuggestions(replaced.diff, replaced.notes),
              replacesProposalId,
            });
            return { ok: true, data: { postId } };
          }
          if (existing) return { ok: true, data: { postId } };
          const { effective } = await loadSnapshots(tx, postId, post);
          await insertDraft(tx, {
            postId,
            reviewerId: actor.id,
            sourceVersion: post.editVersion,
            sourceIsPublic: isPubliclyVisible(post),
            base: proposalSnapshotSchema.parse(effective),
            replacesProposalId: null,
          });
          return { ok: true, data: { postId } };
        },
      )) ?? NOT_FOUND
    );
  } catch (error) {
    return failure("startReview", { postId }, error);
  }
}

export type ReviewWorkspace = {
  draft: ReviewDraftRow;
  outdated: boolean;
  // Guided re-add hints against this draft's base.
  previous: (PreviousSuggestion & ReturnType<typeof previousMatch>)[];
};

export async function getReviewWorkspaceService(
  actor: PostActor,
  postId: string,
): Promise<ReviewWorkspace | null> {
  const post = await reviewablePost(actor, postId);
  if (!post) return null;
  const draft = await findDraft(postId, actor.id);
  if (!draft) return null;
  return {
    draft,
    outdated:
      draft.sourceVersion !== post.editVersion ||
      draft.sourceIsPublic !== isPubliclyVisible(post),
    previous: draft.previous.map((item) => ({
      ...item,
      ...previousMatch(draft.base, item),
    })),
  };
}

// What the review page needs before a draft exists: the post may be
// reviewed by this viewer, and its title.
export async function getReviewTargetService(actor: PostActor, postId: string) {
  const post = await postForSharing(postId);
  if (!post) return null;
  return (await mayReview(actor, { id: postId, authorId: post.authorId }))
    ? { title: post.title }
    : null;
}

export async function saveReviewDraftService(
  session: StaffSession,
  input: SaveReviewDraft,
): Promise<ActionResult<{ revision: number }>> {
  try {
    if (!(await reviewablePost(session.user, input.postId))) return NOT_FOUND;
    const draft = await findDraft(input.postId, session.user.id);
    if (!draft) return NOT_FOUND;
    const problem = draftProblem(
      draft.base,
      input.suggestions,
      input.comments,
      input.metadata,
    );
    if (problem) return { ok: false, error: problem };
    const revision = await writeDraftContent(
      input.postId,
      session.user.id,
      input.revision,
      {
        suggestions: input.suggestions,
        comments: input.comments,
        metadata: input.metadata,
        generalFeedback: input.generalFeedback,
      },
    );
    return revision === null
      ? {
          ...CONFLICT_RESULT,
          error: "This review changed in another tab. Reload to continue.",
        }
      : { ok: true, data: { revision } };
  } catch (error) {
    return failure("saveReviewDraft", { postId: input.postId }, error);
  }
}

// Rebase onto the latest draft. Suggestions become guided re-add items; text
// comments keep their anchor only where the quote is still unambiguous, and
// otherwise move into general feedback with the quote, so nothing is lost.
export async function refreshReviewDraftService(
  session: StaffSession,
  postId: string,
  revision: number,
): Promise<ActionResult<{ postId: string }>> {
  try {
    return (
      (await withLockedSource<ActionResult<{ postId: string }>>(
        postId,
        async (tx, post) => {
          if (
            !(await mayReview(
              session.user,
              { id: postId, authorId: post.authorId },
              tx,
            ))
          )
            return NOT_FOUND;
          const draft = await findDraft(postId, session.user.id, tx, true);
          if (!draft) return NOT_FOUND;
          if (draft.revision !== revision) return CONFLICT_RESULT;
          const { effective } = await loadSnapshots(tx, postId, post);
          const base = proposalSnapshotSchema.parse(effective);
          const comments: DraftComment[] = [];
          const orphaned: string[] = [];
          for (const comment of draft.comments) {
            const match = locatePrevious(base.bodyMd, comment.quote);
            if (match) comments.push({ ...comment, ...match });
            else orphaned.push(`On “${comment.quote}”: ${comment.body}`);
          }
          const generalFeedback = [draft.generalFeedback, ...orphaned]
            .filter(Boolean)
            .join("\n\n");
          if (generalFeedback.length > REVIEW_TEXT_MAX)
            return {
              ok: false,
              error:
                "Some comments no longer match the draft and won't fit in general feedback. Shorten your general feedback or remove those comments, then update again.",
            };
          await replaceDraft(tx, postId, session.user.id, {
            sourceVersion: post.editVersion,
            sourceIsPublic: isPubliclyVisible(post),
            base,
            previous: [
              ...draft.previous,
              ...draft.suggestions.map(
                ({ before, after, explanation, correction }) => ({
                  before,
                  after,
                  explanation,
                  correction,
                }),
              ),
              ...draft.metadata.map(
                ({ field, after, explanation, correction }) => ({
                  field,
                  before: JSON.stringify(draft.base[field]),
                  after: JSON.stringify(after),
                  explanation,
                  correction,
                }),
              ),
            ],
            suggestions: [],
            metadata: [],
            comments,
            generalFeedback,
          });
          return { ok: true, data: { postId } };
        },
      )) ?? NOT_FOUND
    );
  } catch (error) {
    return failure("refreshReviewDraft", { postId }, error);
  }
}

export async function discardReviewDraftService(
  session: StaffSession,
  postId: string,
): Promise<ActionResult<{ postId: string }>> {
  try {
    // A reviewer may always delete their own private draft, even after access
    // was revoked; it reveals nothing.
    const deleted = await deleteDraft(postId, session.user.id);
    return deleted ? { ok: true, data: { postId } } : NOT_FOUND;
  } catch (error) {
    return failure("discardReviewDraft", { postId }, error);
  }
}

export async function submitReviewService(
  session: StaffSession,
  input: { postId: string; revision: number; acceptOutdated: boolean },
): Promise<ActionResult<{ proposalId: string }>> {
  try {
    return (
      (await withLockedSource<ActionResult<{ proposalId: string }>>(
        input.postId,
        async (tx, post) => {
          const actor = session.user;
          if (
            !(await mayReview(
              actor,
              { id: input.postId, authorId: post.authorId },
              tx,
            ))
          )
            return NOT_FOUND;
          const draft = await findDraft(input.postId, actor.id, tx, true);
          if (!draft) return NOT_FOUND;
          if (draft.revision !== input.revision)
            return {
              ...CONFLICT_RESULT,
              error: "This review changed in another tab. Reload to continue.",
            };
          const problem = draftProblem(
            draft.base,
            draft.suggestions,
            draft.comments,
            draft.metadata,
          );
          if (problem) return { ok: false, error: problem };
          if (
            draft.suggestions.length === 0 &&
            draft.metadata.length === 0 &&
            draft.comments.length === 0 &&
            !draft.generalFeedback
          )
            return {
              ok: false,
              error: "Add a suggestion or some feedback before submitting.",
            };
          const outdated =
            draft.sourceVersion !== post.editVersion ||
            draft.sourceIsPublic !== isPubliclyVisible(post);
          if (outdated && !input.acceptOutdated) return OUTDATED_RESULT;
          const { diff, candidate } = createRangeDiff(
            draft.base,
            draft.suggestions,
            draft.metadata,
          );
          // Same candidate rules as AI reviews: valid snapshot, a public post
          // keeps its thumbnail, the category exists and the slug is free.
          if (!proposalSnapshotSchema.safeParse(candidate).success)
            return { ok: false, error: "A suggested detail isn't valid." };
          if (
            (PUBLIC_STATUSES as readonly string[]).includes(post.status) &&
            !postDraftSchema.safeParse(candidate).success
          )
            return {
              ok: false,
              error: "A published or scheduled post must keep its thumbnail.",
            };
          const invalid = await snapshotReferencesValid(
            tx,
            input.postId,
            candidate,
          );
          if (invalid) return { ok: false, error: invalid };
          const reviewerName = await displayName(actor.id, tx);
          const proposal = await insertProposal(tx, {
            postId: input.postId,
            origin: ProposalOrigin.Human,
            reviewerId: actor.id,
            reviewerName,
            // The draft's own source: an outdated review stays readable but
            // the existing stale check keeps it from applying.
            sourceVersion: draft.sourceVersion,
            sourceIsPublic: draft.sourceIsPublic,
            base: draft.base,
            candidate,
            diff,
            notes: humanReviewNotes(
              diff,
              draft.suggestions,
              draft.generalFeedback,
              draft.metadata,
            ),
          });
          if (draft.replacesProposalId) {
            const replaced = await findOwnOpenReview(
              tx,
              draft.replacesProposalId,
              input.postId,
              actor.id,
            );
            if (replaced)
              await closeProposal(tx, replaced.id, {
                status: ProposalStatus.Superseded,
              });
          }
          await insertComments(
            tx,
            draft.comments.map((comment) => ({
              proposalId: proposal.id,
              anchor: {
                start: comment.start,
                end: comment.end,
                quote: comment.quote,
              },
              authorId: actor.id,
              authorName: reviewerName,
              body: comment.body,
            })),
          );
          await deleteDraft(input.postId, actor.id, tx);
          return { ok: true, data: { proposalId: proposal.id } };
        },
      )) ?? NOT_FOUND
    );
  } catch (error) {
    return failure("submitReview", { postId: input.postId }, error);
  }
}

export async function addReviewCommentService(
  session: StaffSession,
  input: {
    proposalId: string;
    changeId: string | null;
    parentId: string | null;
    body: string;
  },
): Promise<ActionResult<{ id: string }>> {
  try {
    const proposal = await findProposalContext(input.proposalId);
    if (!proposal) return NOT_FOUND;
    const access = await resolvePostAccess(session.user, {
      id: proposal.postId,
      authorId: proposal.authorId,
    });
    if (!access || !includesAccess(access, PostAccess.Read)) return NOT_FOUND;
    if (
      input.changeId !== null &&
      !proposal.diff.changes.some((change) => change.id === input.changeId)
    )
      return { ok: false, error: "Unknown suggestion." };
    if (input.parentId !== null) {
      // Replies stay one level deep and inherit the thread's anchor.
      const parent = await findCommentContext(input.parentId);
      if (
        !parent ||
        parent.proposalId !== input.proposalId ||
        parent.parentId !== null ||
        input.changeId !== null
      )
        return { ok: false, error: "Unknown discussion thread." };
    }
    const comment = await insertComment({
      proposalId: input.proposalId,
      changeId: input.changeId,
      parentId: input.parentId,
      authorId: session.user.id,
      authorName: await displayName(session.user.id),
      body: input.body,
    });
    return { ok: true, data: { id: comment.id } };
  } catch (error) {
    return failure("addReviewComment", { proposalId: input.proposalId }, error);
  }
}

// Owner/admin, or the reviewer who wrote the review (Paul, September 27).
export async function setThreadResolvedService(
  session: StaffSession,
  input: { commentId: string; resolved: boolean },
): Promise<ActionResult<{ id: string }>> {
  try {
    const comment = await findCommentContext(input.commentId);
    if (!comment || comment.parentId !== null) return NOT_FOUND;
    const access = await resolvePostAccess(session.user, {
      id: comment.postId,
      authorId: comment.authorId,
    });
    if (!access || !includesAccess(access, PostAccess.Read)) return NOT_FOUND;
    if (access !== PostAccess.Manage && comment.reviewerId !== session.user.id)
      return denied;
    const updated = await setThreadResolved(
      input.commentId,
      input.resolved ? session.user.id : null,
    );
    return updated ? { ok: true, data: { id: input.commentId } } : NOT_FOUND;
  } catch (error) {
    return failure("setThreadResolved", { commentId: input.commentId }, error);
  }
}
