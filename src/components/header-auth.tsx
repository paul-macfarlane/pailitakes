"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { authClient } from "@/lib/auth-client";

// Session-aware corner of the site header. Kept client-side so the header —
// and every ISR page under the public layout — stays statically cacheable
// (design §2: user-specific data lives in small client islands).
export function HeaderAuth() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    // Placeholder matching the avatar footprint to avoid layout shift.
    return <div aria-hidden className="size-8 rounded-full bg-muted" />;
  }

  if (session) {
    return (
      <UserMenu
        name={session.user.name}
        image={session.user.image ?? null}
      />
    );
  }

  return (
    <Link
      href="/sign-in"
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Sign in
    </Link>
  );
}
