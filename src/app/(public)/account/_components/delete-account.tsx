"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

// Better Auth throws this code (BASE_ERROR_CODES.SESSION_EXPIRED, see
// node_modules/better-auth .../dist/api/routes/update-user.mjs deleteUser
// handler) when no password is supplied and the session is older than
// session.freshAge (default 24h). Google/Discord users never have a
// password to satisfy the check another way, so this is their only path to
// a refused delete — worth a friendlier message than the raw server text.
const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

// ACCT-1: self-service account deletion. A beforeDelete hook on the server
// (src/lib/auth/auth.ts) can refuse the request (e.g. staff with authored
// posts, last active admin) — its error.message is written to be shown to
// the user verbatim, so we surface it as-is rather than mapping it.
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const { error: deleteError } = await authClient.deleteUser();
      if (deleteError) {
        if (deleteError.code === SESSION_EXPIRED_CODE) {
          setError(
            "For security, please sign out and sign back in, then try again.",
          );
        } else {
          setError(deleteError.message ?? GENERIC_ERROR_MESSAGE);
        }
        return;
      }
      // The server clears the session cookie as part of deletion — no
      // separate sign-out call needed. refresh() re-reads the (now
      // signed-out) session for anything cached in the layout/header.
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-destructive">
          Danger zone
        </span>
        <p className="text-sm text-muted-foreground">
          Permanently delete your account. This cannot be undone.
        </p>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isPending}
              className="w-fit"
            />
          }
        >
          Delete account
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your sign-in identity and likes are removed permanently. Your
              comments are replaced with anonymous &ldquo;[deleted]&rdquo;
              placeholders so reply threads survive. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={handleConfirm}
            >
              {isPending ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={cn(
          "text-sm",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? (isPending ? "Deleting…" : "")}
      </p>
    </div>
  );
}
