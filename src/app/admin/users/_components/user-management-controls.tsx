"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setUserBanned, setUserRole } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_VALUES, roleLabel, type Role } from "@/lib/auth/roles";

// Per-row role select + ban toggle (ADM-10). Calls the admin-only server
// actions (which re-check auth and the last-admin guard) and refreshes the
// page's server data on success. Self-row controls are disabled — the acting
// admin can't demote or ban themselves (also enforced server-side).
export function UserManagementControls({
  userId,
  role,
  banned,
  isSelf,
}: {
  userId: string;
  role: Role;
  banned: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Label className="sr-only" htmlFor={`role-${userId}`}>
          Role
        </Label>
        <Select
          value={role}
          disabled={isSelf || isPending}
          items={ROLE_VALUES.map((r) => ({ value: r, label: roleLabel(r) }))}
          onValueChange={(value) => {
            if (value) run(() => setUserRole(userId, value));
          }}
        >
          <SelectTrigger id={`role-${userId}`} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_VALUES.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={banned ? "outline" : "destructive"}
          disabled={isSelf || isPending}
          onClick={() => run(() => setUserBanned(userId, !banned))}
        >
          {banned ? "Unban" : "Ban"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
