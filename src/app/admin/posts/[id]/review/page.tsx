import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePostIdParam } from "@/lib/admin/route-params";
import { requireStaff } from "@/lib/auth/session";
import {
  getReviewTargetService,
  getReviewWorkspaceService,
} from "@/lib/reviews/service";
import { listActiveCategories, listAllCategories } from "@/lib/categories/data";
import { ReviewWorkspace } from "./_components/review-workspace";
import { StartReviewButton } from "./_components/start-review-button";

export const metadata: Metadata = {
  title: "Your review",
  robots: { index: false, follow: false },
};

// The reviewer's private in-progress review (FR-7.15). Only its author ever
// sees a draft; the owner sees "Review in progress" until it's submitted.
export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/posts/${id}/review`);
  const postId = requirePostIdParam(id);
  const workspace = await getReviewWorkspaceService(session.user, postId);
  const back = (
    <Link href={`/admin/preview/${postId}`} className="text-sm underline">
      ← Back to post
    </Link>
  );
  if (!workspace) {
    const target = await getReviewTargetService(session.user, postId);
    if (!target) notFound();
    return (
      <div className="space-y-6">
        {back}
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="break-words text-lg">{target.title}</p>
        <p className="text-muted-foreground">
          Suggest edits and leave comments on the draft. Nothing changes in the
          post until its owner chooses what to apply, and only you can see your
          review until you submit it.
        </p>
        {target.ownReviewId ? (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">
              You&apos;ve submitted a review of this post. Edit it (it stays
              available to the owner until you resubmit), or start a separate
              review.
            </p>
            <div className="flex flex-wrap gap-2">
              <StartReviewButton
                postId={postId}
                replacesProposalId={target.ownReviewId}
                label="Edit your review"
              />
              <Link
                href={`/admin/posts/${postId}/reviews/${target.ownReviewId}`}
                className="inline-flex items-center text-sm underline"
              >
                View it
              </Link>
            </div>
            <StartReviewButton
              postId={postId}
              label="Start a separate review"
              variant="outline"
            />
          </div>
        ) : (
          <StartReviewButton postId={postId} />
        )}
      </div>
    );
  }
  const [categories, active] = await Promise.all([
    listAllCategories(),
    listActiveCategories(),
  ]);
  return (
    <div className="space-y-6">
      {back}
      <ReviewWorkspace
        categories={categories.map(({ id, name }) => ({ id, name }))}
        activeCategoryIds={active.map(({ id }) => id)}
        key={`${workspace.draft.sourceVersion}:${workspace.draft.createdAt.toISOString()}`}
        postId={postId}
        workspace={workspace}
      />
    </div>
  );
}
