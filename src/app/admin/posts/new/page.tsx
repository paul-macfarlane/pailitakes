import type { Metadata } from "next";
import Link from "next/link";

import { PostEditorSection } from "@/app/admin/posts/_components/post-editor-section";
import { listActiveCategories } from "@/lib/categories/data";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "New post",
  robots: { index: false, follow: false },
};

export default async function NewPostPage() {
  await requireStaff("/admin/posts/new");
  const categories = await listActiveCategories();
  // Next keeps a navigated-away-from segment mounted-but-hidden (React
  // Activity) and reveals THAT SAME client instance on a later visit, so the
  // server re-rendering /new with initialPost={null} isn't enough to reset the
  // editor: useForm's defaultValues and useState initializers only run on
  // mount. Without this key, returning to /new after the editor created a post
  // (performSave -> router.replace to /[id]/edit) restores the filled-in form
  // AND its postIdRef — so the next save silently UPDATES that post instead of
  // creating a new one. A per-render key forces a genuinely pristine editor,
  // which is the whole contract of this route.
  const editorKey = crypto.randomUUID();

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
          key={editorKey}
          heading="New post"
          categories={categories}
          initialPost={null}
        />
      )}
    </>
  );
}
