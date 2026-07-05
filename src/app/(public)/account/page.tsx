import type { Metadata } from "next";
import { redirect } from "next/navigation";

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

export default async function AccountPage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Signed in as {session.user.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayNameForm initialName={session.user.name} />
        </CardContent>
      </Card>
    </main>
  );
}
