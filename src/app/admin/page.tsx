import Link from "next/link";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  ADMIN_POSTS_PAGE_SIZE,
  listAdminPosts,
  listAuthorOptions,
  listCategoryOptions,
  type AdminPostRow,
} from "@/lib/admin-posts";
import { POST_STATUSES, STATUS_LABELS } from "@/lib/post-status";
import { requireStaff } from "@/lib/session";

// Filters/sort/page live in the URL (server-rendered, no TanStack Query — see
// ADR-0010): shareable, bookmarkable, no loading state. `.catch` makes every
// field degrade to a sensible default rather than throwing on junk input.
const filterSchema = z.object({
  status: z.enum(POST_STATUSES).optional().catch(undefined),
  category: z.coerce.number().int().positive().optional().catch(undefined),
  author: z.uuid().optional().catch(undefined),
  // Blank/oversized/missing search all collapse to undefined (no filter).
  q: z.string().trim().min(1).max(100).optional().catch(undefined),
  sort: z.enum(["updated", "published"]).catch("updated"),
  page: z.coerce.number().int().min(1).catch(1),
});

// UTC-pinned to match the rest of the app's date rendering.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function StatusBadge({ status }: { status: AdminPostRow["status"] }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      {STATUS_LABELS[status]}
    </span>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaff();
  const isAdmin = session.user.role === "admin";
  const filters = filterSchema.parse(await searchParams);

  const [categories, authors] = await Promise.all([
    listCategoryOptions(),
    isAdmin ? listAuthorOptions() : Promise.resolve([]),
  ]);

  // Only apply a category/author filter that's actually a selectable option,
  // so the control and the applied filter never disagree — and an unknown,
  // inactive, or out-of-range id can't reach (and crash) the query. status
  // and sort are already constrained by their zod enums.
  const categoryId = categories.some((c) => c.id === filters.category)
    ? filters.category
    : undefined;
  const authorId =
    isAdmin && authors.some((a) => a.id === filters.author)
      ? filters.author
      : undefined;

  const offset = (filters.page - 1) * ADMIN_POSTS_PAGE_SIZE;
  const { rows, hasMore } = await listAdminPosts({
    user: session.user,
    status: filters.status,
    categoryId,
    authorId,
    q: filters.q,
    sort: filters.sort,
    limit: ADMIN_POSTS_PAGE_SIZE,
    offset,
  });

  // Preserve the (sanitized) active filters — not page — when building a page
  // link, so pagination never carries a dropped/invalid filter.
  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (categoryId) params.set("category", String(categoryId));
    if (authorId) params.set("author", authorId);
    if (filters.q) params.set("q", filters.q);
    if (filters.sort !== "updated") params.set("sort", filters.sort);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/admin?${query}` : "/admin";
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link href="/admin/users" className="text-sm hover:underline">
              Users
            </Link>
          )}
          <Button
            render={<Link href="/admin/posts/new" />}
            nativeButton={false}
          >
            New post
          </Button>
        </div>
      </div>

      {/* Native GET form: submitting rewrites the URL search params. Omitting
          `page` resets to the first page on a new filter. */}
      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Title…"
            maxLength={100}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {POST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Category</span>
          <select
            name="category"
            defaultValue={categoryId ? String(categoryId) : ""}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        {isAdmin && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Author</span>
            <select
              name="author"
              defaultValue={authorId ?? ""}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="">All</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Sort by</span>
          <select
            name="sort"
            defaultValue={filters.sort}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="updated">Last updated</option>
            <option value="published">Published date</option>
          </select>
        </label>

        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          {filters.page > 1
            ? "No posts on this page — go back a page."
            : "No posts match these filters."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((post) => (
            <li
              key={post.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="font-medium hover:underline"
                >
                  {post.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {post.category.name}
                  {isAdmin ? ` · ${post.author.name}` : ""} · Updated{" "}
                  {dateFormat.format(post.updatedAt)}
                </p>
              </div>
              <StatusBadge status={post.status} />
            </li>
          ))}
        </ul>
      )}

      {(filters.page > 1 || hasMore) && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {filters.page > 1 ? (
            <Link href={pageHref(filters.page - 1)} className="hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link href={pageHref(filters.page + 1)} className="hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
