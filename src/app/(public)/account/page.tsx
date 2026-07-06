import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DisplayNameForm } from "@/components/display-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/session";

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
          <Card aria-busy="true">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Loading…</CardDescription>
            </CardHeader>
          </Card>
        }
      >
        <AccountCard />
      </Suspense>
    </main>
  );
}

async function AccountCard() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Signed in as {session.user.email}.</CardDescription>
      </CardHeader>
      <CardContent>
        <DisplayNameForm initialName={session.user.name} />
      </CardContent>
    </Card>
  );
}
