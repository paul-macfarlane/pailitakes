import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInButtons } from "@/components/sign-in-buttons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Sign in",
};

// The card is static (prerendered shell); only the already-signed-in
// redirect needs the session, so it streams as a null-rendering gate.
export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in to comment and like posts. No email/password — Google or
            Discord only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInButtons />
        </CardContent>
      </Card>
    </main>
  );
}

async function RedirectIfSignedIn() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }
  return null;
}
