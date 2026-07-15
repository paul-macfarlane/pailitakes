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
          // Mirrors AccountCards' layout: two stacked cards, each with a
          // title, description, and skeleton body, so the swap doesn't
          // shift layout.
          <div className="flex flex-col gap-6" aria-busy="true">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
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
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
                <CardDescription>
                  <Skeleton className="h-4 w-40" />
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-32" />
              </CardContent>
            </Card>
          </div>
        }
      >
        <AccountCards />
      </Suspense>
      <ViewBeacon path="/account" />
    </main>
  );
}

async function AccountCards() {
  const session = await getSession();
  if (!session) {
    // Reached only with a stale/revoked cookie (the proxy bounced cookieless
    // requests). ?next= restores the destination and exempts this hop from
    // the proxy's signed-in /sign-in → / redirect (stale-cookie trap).
    redirect("/sign-in?next=/account");
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear when you comment.</CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayNameForm initialName={session.user.name} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Signed in as {session.user.email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccount />
        </CardContent>
      </Card>
    </div>
  );
}
