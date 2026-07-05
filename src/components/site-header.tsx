import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { getSession } from "@/lib/session";

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Paulitakes
        </Link>
        {session ? (
          <UserMenu
            name={session.user.name}
            image={session.user.image ?? null}
          />
        ) : (
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
