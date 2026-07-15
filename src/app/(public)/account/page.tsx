import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DeleteAccount } from "@/app/(public)/account/_components/delete-account";
import { DisplayNameForm } from "@/app/(public)/account/_components/display-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewBeacon } from "@/components/view-beacon";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Account",
};

// The card content depends on the session, so it renders inside a Suspense
// boundary (cacheComponents: uncached request data must not block the shell).
export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Suspense
        fallback={
          // Mirrors AccountCard's layout: title, description, labelled input
          // + submit (see DisplayNameForm) so the swap doesn't shift layout.
          <Card aria-busy="true">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                <Skeleton className="h-4 w-48" />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-24" />
            </CardContent>
          </Card>
        }
      >
        <AccountCard />
      </Suspense>
      <ViewBeacon path="/account" />
    </main>
  );
}

async function AccountCard() {
  const session = await getSession();
  if (!session) {
    // Reached only with a stale/revoked cookie (the proxy bounced cookieless
    // requests). ?next= restores the destination and exempts this hop from
    // the proxy's signed-in /sign-in → / redirect (stale-cookie trap).
    redirect("/sign-in?next=/account");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Signed in as {session.user.email}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <DisplayNameForm initialName={session.user.name} />
        {/* Visually separated at the same 375px width the form above is
            verified at — a border-t plus label reads as "different kind of
            action" without a second Card's extra chrome. */}
        <div className="border-t pt-6">
          <DeleteAccount />
        </div>
      </CardContent>
    </Card>
  );
}
