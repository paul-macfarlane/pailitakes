"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// In-shell admin navigation (Posts | Categories | Users). Client-side only
// for active-route highlighting (usePathname). `isAdmin`/`canManageCategories`
// are resolved on the server and passed in, so the admin-only links are
// present in the initial HTML (no post-hydration pop-in); requireAdmin() on
// /admin/users and requireCapability(ManageCategories) on /admin/categories
// are still the real boundaries.
export function AdminNav({
  isAdmin,
  canManageCategories,
}: {
  isAdmin: boolean;
  canManageCategories: boolean;
}) {
  const pathname = usePathname();

  // Users owns /admin/users, Categories owns /admin/categories; everything
  // else under /admin (dashboard, post editor, preview) belongs to Posts.
  const onUsers = pathname.startsWith("/admin/users");
  const onCategories = pathname.startsWith("/admin/categories");

  return (
    <nav aria-label="Admin" className="flex items-center gap-4 text-sm">
      <AdminNavLink href="/admin" active={!onUsers && !onCategories}>
        Posts
      </AdminNavLink>
      {canManageCategories ? (
        <AdminNavLink href="/admin/categories" active={onCategories}>
          Categories
        </AdminNavLink>
      ) : null}
      {isAdmin ? (
        <AdminNavLink href="/admin/users" active={onUsers}>
          Users
        </AdminNavLink>
      ) : null}
    </nav>
  );
}

// Static fallback for the Suspense boundary that resolves `isAdmin` on the
// server. It renders in the prerendered shell of dynamic routes (e.g.
// /admin/posts/[id]/edit), so it must not read request data (usePathname) —
// hence just the always-present Posts link, no active-state, no Users link.
// The resolved AdminNav (active-state + admin-only Users link) streams in.
export function AdminNavFallback() {
  return (
    <nav aria-label="Admin" className="flex items-center gap-4 text-sm">
      <Link
        href="/admin"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Posts
      </Link>
    </nav>
  );
}

function AdminNavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "transition-colors hover:text-foreground",
        active ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}
