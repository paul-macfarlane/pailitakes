import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { UserManagementControls } from "@/components/user-management-controls";
import { Button } from "@/components/ui/button";
import { SEARCH_QUERY_MAX, searchQuerySchema } from "@/lib/admin-search";
import {
  ADMIN_USERS_PAGE_SIZE,
  listUsers,
  type AdminUserRow,
} from "@/lib/admin-users";
import { ROLE_VALUES, roleLabel } from "@/lib/roles";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

const filterSchema = z.object({
  role: z.enum(ROLE_VALUES).optional().catch(undefined),
  q: searchQuerySchema,
  page: z.coerce.number().int().min(1).catch(1),
});

const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function RoleBadge({ user }: { user: AdminUserRow }) {
  return (
    <span className="text-xs text-muted-foreground">
      {roleLabel(user.role)}
      {user.bannedAt ? " · Banned" : ""}
    </span>
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("/admin/users");
  const filters = filterSchema.parse(await searchParams);
  const offset = (filters.page - 1) * ADMIN_USERS_PAGE_SIZE;

  const { rows, hasMore } = await listUsers({
    role: filters.role,
    q: filters.q,
    limit: ADMIN_USERS_PAGE_SIZE,
    offset,
  });

  const hasActiveFilters = Boolean(filters.role) || Boolean(filters.q);

  // Remount the form whenever the applied filters change (Apply, Reset,
  // pagination keeps it stable). A soft navigation reconciles the existing
  // form in place, which does NOT reset an uncontrolled <select>'s value — so
  // without a changing key, Reset would clear the URL but leave the controls
  // showing the old selection.
  const formKey = `${filters.role ?? ""}|${filters.q ?? ""}`;

  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (filters.role) params.set("role", filters.role);
    if (filters.q) params.set("q", filters.q);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/admin/users?${query}` : "/admin/users";
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Users</h1>

      <form
        key={formKey}
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Name or email…"
            maxLength={SEARCH_QUERY_MAX}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Role</span>
          <select
            name="role"
            defaultValue={filters.role ?? ""}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/admin/users" />}
            nativeButton={false}
          >
            Reset
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          {filters.page > 1
            ? "No users on this page — go back a page."
            : "No users match these filters."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((u) => {
            const isSelf = u.id === session.user.id;
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {u.name}
                    {isSelf ? " (you)" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email} · Joined {dateFormat.format(u.createdAt)}
                  </p>
                  <RoleBadge user={u} />
                </div>
                <UserManagementControls
                  userId={u.id}
                  role={u.role}
                  banned={u.bannedAt !== null}
                  isSelf={isSelf}
                />
              </li>
            );
          })}
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
