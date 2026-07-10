import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { HeaderAuth } from "@/components/header-auth";
import { HeaderShell } from "@/components/header-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/session";

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
        <div className="flex items-baseline gap-3">
          {/* Brand returns to the public site; "Admin" is the in-shell home
              link back to the dashboard (feedback: no way back to admin). */}
          <Link href="/" className="text-lg font-bold tracking-tight">
            Paulitakes
          </Link>
          <Link
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Admin
          </Link>
        </div>
        {/* Same right-side controls as the public SiteHeader (theme + account
            menu) so the two headers are consistent. */}
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <HeaderAuth />
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
