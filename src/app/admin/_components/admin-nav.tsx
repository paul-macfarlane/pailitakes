"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  label: string;
  active: boolean;
};

// In-shell admin navigation (Posts | Categories | Announcements | Moderation
// | Analytics | Users). Client-side only for active-route highlighting
// (usePathname). `isAdmin`/`canManageCategories`/`canModerateComments`/
// `canManageAnnouncements`/`canViewAnalytics` are resolved on the server and
// passed in, so the admin-only links are present in the initial HTML (no
// post-hydration pop-in); requireAdmin() on /admin/users,
// requireCapability(ManageCategories) on /admin/categories,
// requireCapability(ModerateComments) on /admin/moderation,
// requireCapability(ManageAnnouncements) on /admin/announcements, and
// requireCapability(ViewAnalytics) on /admin/analytics are still the real
// boundaries.
export function AdminNav({
  isAdmin,
  canManageCategories,
  canModerateComments,
  canManageAnnouncements,
  canViewAnalytics,
}: {
  isAdmin: boolean;
  canManageCategories: boolean;
  canModerateComments: boolean;
  canManageAnnouncements: boolean;
  canViewAnalytics: boolean;
}) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Users owns /admin/users, Categories owns /admin/categories, Moderation
  // owns /admin/moderation, Announcements owns /admin/announcements,
  // Analytics owns /admin/analytics; everything else under /admin
  // (dashboard, post editor, preview) belongs to Posts.
  const onUsers = pathname.startsWith("/admin/users");
  const onCategories = pathname.startsWith("/admin/categories");
  const onModeration = pathname.startsWith("/admin/moderation");
  const onAnnouncements = pathname.startsWith("/admin/announcements");
  const onAnalytics = pathname.startsWith("/admin/analytics");

  const links: NavLink[] = [
    {
      href: "/admin",
      label: "Posts",
      active:
        !onUsers &&
        !onCategories &&
        !onModeration &&
        !onAnnouncements &&
        !onAnalytics,
    },
    ...(canManageCategories
      ? [
          {
            href: "/admin/categories",
            label: "Categories",
            active: onCategories,
          },
        ]
      : []),
    ...(canManageAnnouncements
      ? [
          {
            href: "/admin/announcements",
            label: "Announcements",
            active: onAnnouncements,
          },
        ]
      : []),
    ...(canModerateComments
      ? [
          {
            href: "/admin/moderation",
            label: "Moderation",
            active: onModeration,
          },
        ]
      : []),
    ...(canViewAnalytics
      ? [
          {
            href: "/admin/analytics",
            label: "Analytics",
            active: onAnalytics,
          },
        ]
      : []),
    ...(isAdmin
      ? [{ href: "/admin/users", label: "Users", active: onUsers }]
      : []),
  ];

  return (
    <>
      {/* sm and up: inline links. min-w-0/overflow-x-auto stays as a safety
          net (five links at a narrow desktop window), but the hamburger
          below is now the real mobile mechanism. */}
      <nav
        aria-label="Admin"
        className="hidden min-w-0 items-center gap-4 overflow-x-auto text-sm sm:flex"
      >
        {links.map((link) => (
          <AdminNavLink key={link.href} href={link.href} active={link.active}>
            {link.label}
          </AdminNavLink>
        ))}
      </nav>
      {/* Below sm: a hamburger opens a left-side sheet with the same gated
          links stacked, plus an exit link back to the public site. */}
      <AdminNavSheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {links.map((link) => (
          <AdminNavLink
            key={link.href}
            href={link.href}
            active={link.active}
            onNavigate={() => setSheetOpen(false)}
            className="rounded-md px-2 py-2.5 text-base"
          >
            {link.label}
          </AdminNavLink>
        ))}
      </AdminNavSheet>
    </>
  );
}

// Static fallback for the Suspense boundary that resolves `isAdmin` on the
// server. It renders in the prerendered shell of dynamic routes (e.g.
// /admin/posts/[id]/edit), so it must not read request data (usePathname) —
// hence just the always-present Posts link, no active-state, no Users link.
// The resolved AdminNav (active-state + admin-only links) streams in; the
// hamburger trigger keeps the same dimensions in both states so nothing
// shifts.
export function AdminNavFallback() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Admin"
        className="hidden min-w-0 items-center gap-4 overflow-x-auto text-sm sm:flex"
      >
        <Link
          href="/admin"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Posts
        </Link>
      </nav>
      <AdminNavSheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <Link
          href="/admin"
          onClick={() => setSheetOpen(false)}
          className="rounded-md px-2 py-2.5 text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          Posts
        </Link>
      </AdminNavSheet>
    </>
  );
}

// Shared sheet chrome (trigger, portal, title, "View site" exit link) between
// the resolved nav and its fallback — only the link list in between differs.
// The trigger keeps identical dimensions in both so nothing shifts when the
// resolved nav streams in.
function AdminNavSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Admin navigation"
            className="sm:hidden"
          />
        }
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          {/* Visually hidden: the hamburger already communicates "menu"; the
              title exists to give the sheet an accessible name. */}
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
        </SheetHeader>
        <nav aria-label="Admin" className="flex flex-col gap-1 px-4">
          {children}
        </nav>
        <Separator className="mx-4 w-auto" />
        <div className="px-4 pb-4">
          <Link
            href="/"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-2 py-2.5 text-base text-muted-foreground transition-colors hover:text-foreground"
          >
            View site
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AdminNavLink({
  href,
  active,
  onNavigate,
  className,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "transition-colors hover:text-foreground",
        active ? "font-medium text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
