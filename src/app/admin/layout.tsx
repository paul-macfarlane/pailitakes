import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminNav, AdminNavFallback } from "@/app/admin/_components/admin-nav";
import { HeaderAuth, HeaderAuthFallback } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdmin } from "@/lib/auth/permissions";
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
          {/* Brand returns to the public site; the in-shell nav toggles between
              the Posts and Users sections (feedback: consistent admin nav). */}
          <Link href="/" className="text-lg font-bold tracking-tight">
            Paulitakes
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

// Resolves the admin-only Users link server-side. UX only — requireAdmin() on
// /admin/users is the real boundary — so a missing/non-admin session just
// hides the link.
async function AdminNavSection() {
  const session = await getSession();
  return <AdminNav isAdmin={session ? isAdmin(session.user) : false} />;
}
