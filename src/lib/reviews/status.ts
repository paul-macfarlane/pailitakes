import "server-only";
import { ProposalStatus } from "@/lib/proposals/input";
import { reviewActivity } from "./data";
import type { ReviewStatus } from "./input";
import { headlineStatus, reviewerStatus } from "./suggestions";

// Callers pass only posts the viewer may already list, so statuses reveal
// nothing new.
export async function reviewStatusesByPost(postIds: string[]) {
  const perReviewer = await reviewerStatusesByPost(postIds);
  const result = new Map<string, ReviewStatus | null>();
  for (const postId of postIds)
    result.set(
      postId,
      headlineStatus([...(perReviewer.get(postId)?.values() ?? [])]),
    );
  return result;
}

export async function reviewerStatusesByPost(
  postIds: string[],
): Promise<Map<string, Map<string, ReviewStatus | null>>> {
  const { requests, drafts, latest } = await reviewActivity(postIds);
  type Facts = {
    hasDraft: boolean;
    requestedAt: Date | null;
    latestReview: { createdAt: Date; open: boolean } | null;
  };
  const facts = new Map<string, Map<string, Facts>>();
  const entry = (postId: string, reviewerId: string) => {
    const byReviewer = facts.get(postId) ?? new Map<string, Facts>();
    facts.set(postId, byReviewer);
    const current = byReviewer.get(reviewerId) ?? {
      hasDraft: false,
      requestedAt: null,
      latestReview: null,
    };
    byReviewer.set(reviewerId, current);
    return current;
  };
  for (const r of requests)
    entry(r.postId, r.reviewerId).requestedAt = r.requestedAt;
  for (const d of drafts) entry(d.postId, d.reviewerId).hasDraft = true;
  for (const r of latest) {
    if (!r.reviewerId) continue;
    entry(r.postId, r.reviewerId).latestReview = {
      createdAt: r.createdAt,
      open: r.status === ProposalStatus.Open,
    };
  }
  const result = new Map<string, Map<string, ReviewStatus | null>>();
  for (const [postId, byReviewer] of facts) {
    result.set(
      postId,
      new Map(
        [...byReviewer].map(([reviewerId, f]) => [
          reviewerId,
          reviewerStatus(f),
        ]),
      ),
    );
  }
  return result;
}
