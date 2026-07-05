import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInButtons } from "@/components/sign-in-buttons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { enabledProviders } from "@/lib/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in to comment and like posts. No email/password — Google or
            Discord only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enabledProviders.length > 0 ? (
            <SignInButtons providers={enabledProviders} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign-in isn&apos;t configured in this environment yet (missing
              OAuth credentials).
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
