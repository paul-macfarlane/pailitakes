import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminNav, AdminNavFallback } from "@/app/admin/_components/admin-nav";
import { HeaderAuth, HeaderAuthFallback } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import { getSession, requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// The role gate depends on the session, so it renders inside a Suspense
// boundary (cacheComponents: uncached request data must not block the shell).
// This gate covers the admin chrome only — layouts and pages render in
// parallel, so every /admin page must call requireStaff() itself; the proxy
// redirect is UX convenience only.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <HeaderShell maxWidthClass="max-w-5xl">
        <div className="flex min-w-0 items-center gap-5">
          {/* Brand names the area you're in and returns to the admin home;
              the in-shell nav toggles between the Posts/Categories/
              Moderation/Users sections (feedback: consistent admin nav). */}
          <Link
            href="/admin"
            className="font-heading text-2xl font-bold uppercase tracking-wide whitespace-nowrap"
          >
            Paulitakes Admin
          </Link>
          {/* Users link is admin-only and resolved server-side; the fallback
              renders the always-present Posts link so the shell still streams
              without blocking on the session read (getSession is cache()'d and
              deduped with the gate below). The fallback is request-data-free
              (no usePathname) so it's valid in the prerendered shell of a
              dynamic route like /admin/posts/[id]/edit (cacheComponents). */}
          <Suspense fallback={<AdminNavFallback />}>
            <AdminNavSection />
          </Suspense>
        </div>
        {/* Same right-side controls as the public SiteHeader (theme + account
            menu) so the two headers are consistent. */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Exit link back to the public app — the brand now points at
              /admin, so nothing else in the admin chrome reaches the public
              site (feedback 2026-07-12: admins need a way back). Inline
              styling matches AdminNavLink's inactive state rather than
              importing that component, since this isn't a section toggle
              with active-route highlighting. Hidden below sm: the admin nav's
              hamburger sheet carries its own "View site" link at that width
              (feedback: replace horizontal-scroll nav with a standard
              hamburger). */}
          <Link
            href="/"
            className="hidden px-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            View site
          </Link>
          <ThemeToggle />
          {/* HeaderAuth reads usePathname; wrap so it's deferred out of the
              prerendered shell on dynamic routes (cacheComponents). */}
          <Suspense fallback={<HeaderAuthFallback />}>
            <HeaderAuth />
          </Suspense>
        </div>
      </HeaderShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          }
        >
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireStaff();

  return <>{children}</>;
}

// Resolves the admin-only Users/Categories/Moderation/Announcements links
// server-side. UX only — requireAdmin() on /admin/users,
// requireCapability(ManageCategories) on /admin/categories,
// requireCapability(ModerateComments) on /admin/moderation, and
// requireCapability(ManageAnnouncements) on /admin/announcements are the
// real boundaries — so a missing/non-admin session just hides the links.
async function AdminNavSection() {
  const session = await getSession();
  return (
    <AdminNav
      isAdmin={
        session ? canPerformAction(session.user, Action.ManageUsers) : false
      }
      canManageCategories={
        session
          ? canPerformAction(session.user, Action.ManageCategories)
          : false
      }
      canModerateComments={
        session
          ? canPerformAction(session.user, Action.ModerateComments)
          : false
      }
      canManageAnnouncements={
        session
          ? canPerformAction(session.user, Action.ManageAnnouncements)
          : false
      }
    />
  );
}
