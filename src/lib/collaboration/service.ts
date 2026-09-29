import "server-only";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/posts/data";
import {
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import { reviewerStatusesByPost } from "@/lib/reviews/status";
import {
  changeMembership,
  collaboratorOptions,
  collaboratorsFor,
  isActiveAuthor,
  markReviewRequested,
  membershipFor,
  postForSharing,
  sharedPostsFor,
  withLockedMembership,
} from "./data";
import {
  includesAccess,
  PostAccess,
  postAccessLevel,
  revokesEditAccess,
  type CollaboratorRole,
  type PostActor,
} from "./permissions";

type PostRef = { id: string; authorId: string };

// Skips the membership query for owners, admins and non-staff.
export async function resolvePostAccess(
  actor: PostActor,
  post: PostRef,
  tx?: Tx,
): Promise<PostAccess | null> {
  if (!canPerformAction(actor, Action.EditPost)) return null;
  const direct = postAccessLevel(actor, post.authorId, null);
  if (direct !== null) return direct;
  return postAccessLevel(
    actor,
    post.authorId,
    await membershipFor(post.id, actor.id, tx),
  );
}

export async function hasPostAccess(
  actor: PostActor,
  post: PostRef,
  access: PostAccess,
  tx?: Tx,
): Promise<boolean> {
  return includesAccess(await resolvePostAccess(actor, post, tx), access);
}

const denied = { ok: false, error: NOT_AUTHORIZED_ERROR } as const;

export async function setCollaboratorService(
  actor: PostActor,
  input: { postId: string; userId: string; role: CollaboratorRole | null },
): Promise<ActionResult<{ postId: string }>> {
  try {
    return (
      (await withLockedMembership(input.postId, async (tx, post) => {
        if (postAccessLevel(actor, post.authorId, null) !== PostAccess.Manage)
          return denied;
        if (input.userId === post.authorId)
          return {
            ok: false,
            error: "The post owner already has full access.",
          } as const;
        if (input.role !== null && !(await isActiveAuthor(tx, input.userId)))
          return { ok: false, error: "Choose an active author." } as const;
        const current = await membershipFor(input.postId, input.userId, tx);
        if (current !== input.role)
          await changeMembership(
            tx,
            input.postId,
            input.userId,
            input.role,
            revokesEditAccess(current, input.role),
          );
        return { ok: true, data: { postId: input.postId } } as const;
      })) ?? denied
    );
  } catch (error) {
    console.error("setCollaborator failed", {
      postId: input.postId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: GENERIC_ERROR };
  }
}

// null for missing and not-managed alike (no existence oracle).
export async function getCollaboratorsService(
  actor: PostActor,
  postId: string,
) {
  const post = await postForSharing(postId);
  if (
    !post ||
    postAccessLevel(actor, post.authorId, null) !== PostAccess.Manage
  )
    return null;
  const [members, options, statuses] = await Promise.all([
    collaboratorsFor(postId),
    collaboratorOptions(post.authorId),
    reviewerStatusesByPost([postId]),
  ]);
  const byReviewer = statuses.get(postId);
  return {
    title: post.title,
    members: members.map((member) => ({
      ...member,
      reviewStatus: byReviewer?.get(member.userId) ?? null,
    })),
    options,
  };
}

export async function sharedPostsService(actor: PostActor) {
  // Demoted/banned members keep their rows but see nothing.
  if (!canPerformAction(actor, Action.EditPost)) return [];
  const rows = await sharedPostsFor(actor.id);
  const statuses = await reviewerStatusesByPost(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    reviewStatus: statuses.get(row.id)?.get(actor.id) ?? null,
  }));
}

// Owner/admin asks one collaborator for a review; status derives from it.
export async function requestReviewService(
  actor: PostActor,
  input: { postId: string; userId: string },
): Promise<ActionResult<{ postId: string }>> {
  try {
    return (
      (await withLockedMembership(input.postId, async (tx, post) => {
        if (postAccessLevel(actor, post.authorId, null) !== PostAccess.Manage)
          return denied;
        return (await markReviewRequested(tx, input.postId, input.userId))
          ? ({ ok: true, data: { postId: input.postId } } as const)
          : ({ ok: false, error: "Share the post with them first." } as const);
      })) ?? denied
    );
  } catch {
    console.error("requestReview failed", { postId: input.postId });
    return { ok: false, error: GENERIC_ERROR };
  }
}
