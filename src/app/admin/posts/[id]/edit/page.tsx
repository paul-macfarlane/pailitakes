import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostEditor } from "@/components/post-editor";
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
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Edit post</h1>
        <Link
          href={`/admin/preview/${post.id}`}
          target="_blank"
          rel="noopener"
          className="text-sm font-medium underline hover:text-foreground"
        >
          Preview
        </Link>
      </div>
      <div className="mb-6 flex flex-col gap-4">
        <PostStatusControls postId={post.id} status={post.status} />
        <PostScheduleControls
          postId={post.id}
          status={post.status}
          publishAt={post.publishAt}
          archiveAt={post.archiveAt}
        />
      </div>
      <PostEditor categories={categories} initialPost={post} />
    </>
  );
}
