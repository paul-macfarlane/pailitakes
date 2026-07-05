"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function UserMenu({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  const router = useRouter();
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function handleSignOut() {
    setSignOutFailed(false);
    const { error } = await authClient.signOut();
    if (error) {
      setSignOutFailed(true);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {signOutFailed ? (
        <p role="alert" className="text-xs text-destructive">
          Sign out failed — try again.
        </p>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Account menu"
            />
          }
        >
          <Avatar className="h-8 w-8">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback>
              {name.slice(0, 1).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Base UI: GroupLabel must live inside a Group (ADR-0006). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="max-w-48 truncate">
              {name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/account" />}>
              Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Base UI items fire onClick, not Radix's onSelect (ADR-0006). */}
            <DropdownMenuItem onClick={handleSignOut}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
