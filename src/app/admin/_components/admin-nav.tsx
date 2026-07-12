"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// In-shell admin navigation (Posts | Categories | Moderation | Users).
// Client-side only for active-route highlighting (usePathname).
// `isAdmin`/`canManageCategories`/`canModerateComments` are resolved on the
// server and passed in, so the admin-only links are present in the initial
// HTML (no post-hydration pop-in); requireAdmin() on /admin/users,
// requireCapability(ManageCategories) on /admin/categories, and
// requireCapability(ModerateComments) on /admin/moderation are still the
// real boundaries.
export function AdminNav({
  isAdmin,
  canManageCategories,
  canModerateComments,
}: {
  isAdmin: boolean;
  canManageCategories: boolean;
  canModerateComments: boolean;
}) {
  const pathname = usePathname();

  // Users owns /admin/users, Categories owns /admin/categories, Moderation
  // owns /admin/moderation; everything else under /admin (dashboard, post
  // editor, preview) belongs to Posts.
  const onUsers = pathname.startsWith("/admin/users");
  const onCategories = pathname.startsWith("/admin/categories");
  const onModeration = pathname.startsWith("/admin/moderation");

  return (
    <nav
      aria-label="Admin"
      // min-w-0 + overflow-x-auto: four links (five once every gate is on)
      // no longer reliably fit the header at phone width (FR-9.4) — scroll
      // the nav itself horizontally rather than letting it overflow the flex
      // row and get painted under the theme/account controls (which sit in a
      // shrink-0 box and would otherwise swallow pointer events).
      className="flex min-w-0 items-center gap-4 overflow-x-auto text-sm"
    >
      <AdminNavLink
        href="/admin"
        active={!onUsers && !onCategories && !onModeration}
      >
        Posts
      </AdminNavLink>
      {canManageCategories ? (
        <AdminNavLink href="/admin/categories" active={onCategories}>
          Categories
        </AdminNavLink>
      ) : null}
      {canModerateComments ? (
        <AdminNavLink href="/admin/moderation" active={onModeration}>
          Moderation
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
    <nav
      aria-label="Admin"
      // Same min-w-0/overflow-x-auto treatment as the resolved AdminNav below
      // (this fallback only ever renders one link, but the classes must match
      // so nothing shifts once the resolved nav streams in).
      className="flex min-w-0 items-center gap-4 overflow-x-auto text-sm"
    >
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
