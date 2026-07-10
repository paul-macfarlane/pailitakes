import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostArticle } from "@/components/post-article";
import { getPostForPreview } from "@/lib/posts/admin";
import { requirePostIdParam } from "@/lib/admin/route-params";
import { renderMarkdown } from "@/lib/content/markdown";
import { isPubliclyVisible, STATUS_LABELS } from "@/lib/posts/status";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

// Private preview (design §5.7): renders any post — including draft/scheduled/
// archived, which the public page won't show — exactly as it will publish,
// via the shared PostArticle. Auth-gated (requireStaff) and ownership-scoped
// (getPostForPreview), so it never leaks an unpublished post.
export default async function PreviewPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/preview/${id}`);
  const postId = requirePostIdParam(id);

  const post = await getPostForPreview(postId, session.user);
  if (!post) notFound();

  const bodyHtml = await renderMarkdown(post.bodyMd);
  // Real visibility, not the raw status: a scheduled post past its publish_at
  // is already live (visiblePostsWhere), and a published post with a future
  // publish_at or a passed archive_at is not.
  const isLive = isPubliclyVisible(post);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted-foreground">
          Preview · {STATUS_LABELS[post.status]}
          {post.hasPendingChanges
            ? " · pending changes — not yet published"
            : isLive
              ? ""
              : " — not visible to the public"}
        </span>
        <Link
          href={`/admin/posts/${post.id}/edit`}
          className="font-medium underline hover:text-foreground"
        >
          Edit post
        </Link>
      </div>
      <PostArticle post={{ ...post, bodyHtml }} />
    </div>
  );
}
