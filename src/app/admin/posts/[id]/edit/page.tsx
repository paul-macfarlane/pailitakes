import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostEditorSection } from "@/components/post-editor-section";
import { PostPendingControls } from "@/components/post-pending-controls";
import { PostScheduleControls } from "@/components/post-schedule-controls";
import { PostStatusControls } from "@/components/post-status-controls";
import { getEditablePost, listCategoryOptions } from "@/lib/admin-posts";
import { requirePostIdParam } from "@/lib/admin-route";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = {
  title: "Edit post",
  robots: { index: false, follow: false },
};

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/posts/${id}/edit`);
  const postId = requirePostIdParam(id);

  const [post, categories] = await Promise.all([
    getEditablePost(postId, session.user),
    listCategoryOptions(),
  ]);
  if (!post) notFound();

  return (
    <>
      <Link
        href="/admin"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Posts
      </Link>
      <PostEditorSection
        heading="Edit post"
        previewHref={`/admin/preview/${post.id}`}
        categories={categories}
        initialPost={post}
      >
        <div className="mb-6 flex flex-col gap-4">
          {post.hasPendingChanges ? (
            <PostPendingControls
              postId={post.id}
              draftUpdatedAt={post.draftUpdatedAt}
            />
          ) : null}
          <PostStatusControls
            postId={post.id}
            status={post.status}
            pendingChanges={post.hasPendingChanges}
          />
          <PostScheduleControls
            postId={post.id}
            status={post.status}
            publishAt={post.publishAt}
            archiveAt={post.archiveAt}
            pendingChanges={post.hasPendingChanges}
          />
        </div>
      </PostEditorSection>
    </>
  );
}
