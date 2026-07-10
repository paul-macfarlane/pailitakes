"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// In-shell admin navigation (Posts | Users). Client-side only for active-route
// highlighting (usePathname). `isAdmin` is resolved on the server and passed
// in, so the Users link is present in the initial HTML (no post-hydration
// pop-in); requireAdmin() on /admin/users is still the real boundary.
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  // Users owns /admin/users; everything else under /admin (dashboard, post
  // editor, preview) belongs to Posts.
  const onUsers = pathname.startsWith("/admin/users");

  return (
    <nav aria-label="Admin" className="flex items-center gap-4 text-sm">
      <AdminNavLink href="/admin" active={!onUsers}>
        Posts
      </AdminNavLink>
      {isAdmin ? (
        <AdminNavLink href="/admin/users" active={onUsers}>
          Users
        </AdminNavLink>
      ) : null}
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
