"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import {
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
} from "@/lib/display-name";

export function DisplayNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDisplayName(name);
    if (!normalized) {
      setStatus({ kind: "error", message: "Display name can't be empty." });
      return;
    }
    setStatus({ kind: "saving" });
    const { error } = await authClient.updateUser({ name: normalized });
    if (error) {
      setStatus({
        kind: "error",
        message: "Couldn't save your name. Please try again.",
      });
      return;
    }
    setStatus({ kind: "saved" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          name="display-name"
          value={name}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Shown on your comments.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status.kind === "saving"}>
          {status.kind === "saving" ? "Saving…" : "Save"}
        </Button>
        {status.kind === "saved" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Saved.
          </p>
        ) : null}
        {status.kind === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
