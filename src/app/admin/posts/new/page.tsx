import type { Metadata } from "next";
import Link from "next/link";

import { PostEditorSection } from "@/components/post-editor-section";
import { listCategoryOptions } from "@/lib/posts/admin";
import { requireStaff } from "@/lib/auth/session";

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
      {categories.length === 0 ? (
        <>
          <h1 className="mb-6 text-2xl font-semibold">New post</h1>
          <p className="text-muted-foreground">Create a category first.</p>
        </>
      ) : (
        <PostEditorSection
          heading="New post"
          categories={categories}
          initialPost={null}
        />
      )}
    </>
  );
}
