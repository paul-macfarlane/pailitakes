import type { Metadata } from "next";
import Link from "next/link";

import { PostEditor } from "@/components/post-editor";
import { listCategoryOptions } from "@/lib/admin-posts";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = {
  title: "New post",
  robots: { index: false, follow: false },
};

export default async function NewPostPage() {
  await requireStaff("/admin/posts/new");
  const categories = await listCategoryOptions();

  return (
    <>
      <Link
        href="/admin"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Posts
      </Link>
      <h1 className="mb-6 text-2xl font-semibold">New post</h1>
      {categories.length === 0 ? (
        <p className="text-muted-foreground">Create a category first.</p>
      ) : (
        <PostEditor categories={categories} initialPost={null} />
      )}
    </>
  );
}
