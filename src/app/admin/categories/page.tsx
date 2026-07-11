import type { Metadata } from "next";

import { CategoryCreateForm } from "@/app/admin/categories/_components/category-create-form";
import { CategoryRowControls } from "@/app/admin/categories/_components/category-row-controls";
import { listAllCategories } from "@/lib/categories/data";
import { Action } from "@/lib/auth/permissions";
import { requireCapability } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Categories",
  robots: { index: false, follow: false },
};

// Admin-only (FR-2.1: fixed, admin-managed category list). A staff-but-non-
// admin author gets a 404 here — same requireCapability/notFound() pattern
// as requireAdmin on /admin/users.
export default async function AdminCategoriesPage() {
  await requireCapability(Action.ManageCategories, "/admin/categories");
  const categories = await listAllCategories();

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Categories</h1>

      <CategoryCreateForm />

      {categories.length === 0 ? (
        <p className="text-muted-foreground">No categories yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {categories.map((category) => (
            <li
              key={category.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p
                  className={
                    category.active
                      ? "font-medium"
                      : "font-medium text-muted-foreground"
                  }
                >
                  {category.name}
                  {category.active ? null : (
                    <span className="ml-2 text-xs">Inactive</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {category.slug}
                </p>
              </div>
              <CategoryRowControls
                categoryId={category.id}
                name={category.name}
                sortOrder={category.sortOrder}
                active={category.active}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
