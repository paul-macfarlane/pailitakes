"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCategory } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Add-category form (SRCH-1). Same useTransition + inline error +
// router.refresh() pattern as CategoryRowControls/UserManagementControls;
// clears the input on success.
export function CategoryCreateForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCategory(name.trim());
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        setName("");
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="mb-6 flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-56">
          <FieldLabel htmlFor="new-category-name">New category</FieldLabel>
          <Input
            id="new-category-name"
            value={name}
            disabled={isPending}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. NHL"
          />
        </Field>
        <Button
          type="button"
          size="sm"
          disabled={isPending || name.trim().length === 0}
          onClick={handleAdd}
        >
          Add
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
