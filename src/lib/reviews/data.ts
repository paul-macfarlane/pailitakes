import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  editProposals,
  postCollaborators,
  posts,
  reviewComments,
  reviewDrafts,
  user,
} from "@/db/schema";
import { Action, rolesWithAction } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/posts/data";
import { ProposalOrigin, ProposalStatus } from "@/lib/proposals/input";
import type { DraftComment, DraftMetadataEdit, DraftSuggestion } from "./input";

export type ReviewDraftRow = typeof reviewDrafts.$inferSelect;
export type ReviewCommentRow = typeof reviewComments.$inferSelect;

const draftKey = (postId: string, reviewerId: string) =>
  and(eq(reviewDrafts.postId, postId), eq(reviewDrafts.reviewerId, reviewerId));

export async function findDraft(
  postId: string,
  reviewerId: string,
  tx?: Tx,
  lock = false,
): Promise<ReviewDraftRow | undefined> {
  const query = (tx ?? db)
    .select()
    .from(reviewDrafts)
    .where(draftKey(postId, reviewerId));
  const [row] = await (lock ? query.for("update") : query);
  return row;
}

export async function insertDraft(
  tx: Tx,
  values: typeof reviewDrafts.$inferInsert,
): Promise<ReviewDraftRow> {
  const [row] = await tx.insert(reviewDrafts).values(values).returning();
  return row!;
}

// Revision CAS: a second tab of the same reviewer can't silently overwrite
// newer draft content.
export async function writeDraftContent(
  postId: string,
  reviewerId: string,
  expectedRevision: number,
  content: {
    suggestions: DraftSuggestion[];
    comments: DraftComment[];
    metadata: DraftMetadataEdit[];
    generalFeedback: string;
  },
): Promise<number | null> {
  const [row] = await db
    .update(reviewDrafts)
    .set({
      ...content,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        draftKey(postId, reviewerId),
        eq(reviewDrafts.revision, expectedRevision),
      ),
    )
    .returning({ revision: reviewDrafts.revision });
  return row?.revision ?? null;
}

export async function replaceDraft(
  tx: Tx,
  postId: string,
  reviewerId: string,
  values: Partial<typeof reviewDrafts.$inferInsert>,
): Promise<ReviewDraftRow> {
  const [row] = await tx
    .update(reviewDrafts)
    .set({
      ...values,
      revision: sql`${reviewDrafts.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(draftKey(postId, reviewerId))
    .returning();
  return row!;
}

export async function deleteDraft(
  postId: string,
  reviewerId: string,
  tx?: Tx,
): Promise<boolean> {
  const rows = await (tx ?? db)
    .delete(reviewDrafts)
    .where(draftKey(postId, reviewerId))
    .returning({ postId: reviewDrafts.postId });
  return rows.length > 0;
}

export async function displayName(id: string, tx?: Tx): Promise<string> {
  const [row] = await (tx ?? db)
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, id));
  return row?.name ?? "Former author";
}

export async function insertComments(
  tx: Tx,
  rows: (typeof reviewComments.$inferInsert)[],
): Promise<void> {
  if (rows.length) await tx.insert(reviewComments).values(rows);
}

export async function insertComment(
  values: typeof reviewComments.$inferInsert,
): Promise<ReviewCommentRow> {
  const [row] = await db.insert(reviewComments).values(values).returning();
  return row!;
}

export async function listComments(
  proposalId: string,
  tx?: Tx,
): Promise<ReviewCommentRow[]> {
  return (tx ?? db)
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.proposalId, proposalId))
    .orderBy(asc(reviewComments.createdAt), asc(reviewComments.id));
}

// The comment with what its authorization needs: the review's post owner and
// human reviewer.
export async function findCommentContext(id: string) {
  const [row] = await db
    .select({
      id: reviewComments.id,
      proposalId: reviewComments.proposalId,
      parentId: reviewComments.parentId,
      postId: editProposals.postId,
      reviewerId: editProposals.reviewerId,
      authorId: posts.authorId,
    })
    .from(reviewComments)
    .innerJoin(editProposals, eq(editProposals.id, reviewComments.proposalId))
    .innerJoin(posts, eq(posts.id, editProposals.postId))
    .where(eq(reviewComments.id, id));
  return row;
}

export async function findProposalContext(id: string) {
  const [row] = await db
    .select({
      id: editProposals.id,
      postId: editProposals.postId,
      diff: editProposals.diff,
      authorId: posts.authorId,
    })
    .from(editProposals)
    .innerJoin(posts, eq(posts.id, editProposals.postId))
    .where(eq(editProposals.id, id));
  return row;
}

// Resolution toggles only on a top-level thread (the reply check forbids it
// on replies at the database level too).
export async function setThreadResolved(
  id: string,
  resolvedBy: string | null,
): Promise<boolean> {
  const rows = await db
    .update(reviewComments)
    .set({
      resolvedAt: resolvedBy ? new Date() : null,
      resolvedBy,
    })
    .where(and(eq(reviewComments.id, id), isNull(reviewComments.parentId)))
    .returning({ id: reviewComments.id });
  return rows.length > 0;
}

export async function latestOwnOpenReviewId(
  postId: string,
  reviewerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: editProposals.id })
    .from(editProposals)
    .where(
      and(
        eq(editProposals.postId, postId),
        eq(editProposals.origin, ProposalOrigin.Human),
        eq(editProposals.reviewerId, reviewerId),
        eq(editProposals.status, ProposalStatus.Open),
      ),
    )
    .orderBy(desc(editProposals.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function findOwnOpenReview(
  tx: Tx,
  proposalId: string,
  postId: string,
  reviewerId: string,
) {
  const [row] = await tx
    .select()
    .from(editProposals)
    .where(
      and(
        eq(editProposals.id, proposalId),
        eq(editProposals.postId, postId),
        eq(editProposals.origin, ProposalOrigin.Human),
        eq(editProposals.reviewerId, reviewerId),
        eq(editProposals.status, ProposalStatus.Open),
      ),
    );
  return row;
}

// Everything reviewer status derives from, for a page of posts in 3 queries.
// Requests and drafts count only while their reviewer can still review the
// post (not banned; an admin, or a staff member still shared on it), so a
// demotion or ban can't leave a status stuck. Submitted reviews always count.
export async function reviewActivity(postIds: string[]) {
  if (postIds.length === 0) return { requests: [], drafts: [], latest: [] };
  const staff = rolesWithAction(Action.EditPost);
  const admins = rolesWithAction(Action.ManageAnyPost);
  const [requests, drafts, latest] = await Promise.all([
    db
      .select({
        postId: postCollaborators.postId,
        reviewerId: postCollaborators.userId,
        requestedAt: postCollaborators.reviewRequestedAt,
      })
      .from(postCollaborators)
      .innerJoin(user, eq(user.id, postCollaborators.userId))
      .where(
        and(
          inArray(postCollaborators.postId, postIds),
          isNotNull(postCollaborators.reviewRequestedAt),
          inArray(user.role, staff),
          isNull(user.bannedAt),
        ),
      ),
    db
      .select({
        postId: reviewDrafts.postId,
        reviewerId: reviewDrafts.reviewerId,
      })
      .from(reviewDrafts)
      .innerJoin(user, eq(user.id, reviewDrafts.reviewerId))
      .leftJoin(
        postCollaborators,
        and(
          eq(postCollaborators.postId, reviewDrafts.postId),
          eq(postCollaborators.userId, reviewDrafts.reviewerId),
        ),
      )
      .where(
        and(
          inArray(reviewDrafts.postId, postIds),
          isNull(user.bannedAt),
          or(
            inArray(user.role, admins),
            and(inArray(user.role, staff), isNotNull(postCollaborators.userId)),
          ),
        ),
      ),
    db
      .selectDistinctOn([editProposals.postId, editProposals.reviewerId], {
        postId: editProposals.postId,
        reviewerId: editProposals.reviewerId,
        createdAt: editProposals.createdAt,
        status: editProposals.status,
      })
      .from(editProposals)
      .where(
        and(
          inArray(editProposals.postId, postIds),
          eq(editProposals.origin, ProposalOrigin.Human),
          isNotNull(editProposals.reviewerId),
        ),
      )
      .orderBy(
        editProposals.postId,
        editProposals.reviewerId,
        desc(editProposals.createdAt),
      ),
  ]);
  return { requests, drafts, latest };
}
