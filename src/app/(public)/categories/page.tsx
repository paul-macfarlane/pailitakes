import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";

import { listActiveCategories } from "@/lib/categories/data";

export const metadata: Metadata = {
  title: "Categories",
};

// Active categories only (FR-2.1 locked decision): deactivating a category
// hides it from this index and from pickers, but its own /categories/[slug]
// page stays reachable and keeps rendering its posts. Cached and tagged
// `post-list` (design §3) so createCategory/updateCategory's revalidateTag
// keeps this index fresh; 60s cacheLife is the background-revalidation
// safety net, matching every other listing page in this epic.
export default async function CategoriesIndexPage() {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  const categories = await listActiveCategories();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Categories</h1>

      {categories.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No categories yet.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/categories/${category.slug}`}
                className="block rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
