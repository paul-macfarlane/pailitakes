"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { transferUserPosts } from "@/actions/users";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Bulk-reassigns every post authored by this row's user to another active
// staff member (ACCT-1 follow-up) — the admin escape hatch for the posts
// prepareAccountDeletion otherwise refuses to purge (ever-public or
// commented). `staffOptions` comes from listActiveStaffOptions
// (src/lib/users/admin.ts), already scoped to non-banned staff; this row's
// own id is filtered out here so a user can't be offered as their own
// transfer target. Renders nothing when there's no other eligible staff
// member (e.g. a single-admin site).
export function TransferPostsControl({
  userId,
  staffOptions,
}: {
  userId: string;
  staffOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const selectId = useId();
  const candidates = staffOptions.filter((option) => option.id !== userId);
  const [open, setOpen] = useState(false);
  // null, not undefined: Base UI decides controlled-vs-uncontrolled from the
  // FIRST render's value, and undefined reads as uncontrolled — the first
  // selection would then flip the Select to controlled (console error). null
  // is the controlled-empty sentinel that keeps the placeholder showing.
  const [targetId, setTargetId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) {
    return null;
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setTargetId(null);
    }
  }

  function handleConfirm() {
    if (!targetId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await transferUserPosts(userId, targetId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
            />
          }
        >
          Transfer posts
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer posts</AlertDialogTitle>
            <AlertDialogDescription>
              Moves every post this user authored to another active staff
              member. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label htmlFor={selectId} className="flex-col items-start gap-1">
            Transfer to
            <Select
              items={candidates.map((c) => ({ value: c.id, label: c.name }))}
              value={targetId}
              onValueChange={(value) => setTargetId(value)}
            >
              <SelectTrigger id={selectId} className="w-full">
                <SelectValue placeholder="Choose a staff member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          {/* Failures keep the dialog open, so the message must render
              INSIDE it — a paragraph outside sits behind the dialog overlay
              where the user can't see it (same fix as the delete dialogs). */}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || !targetId}
              onClick={handleConfirm}
            >
              {isPending ? "Transferring…" : "Transfer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
