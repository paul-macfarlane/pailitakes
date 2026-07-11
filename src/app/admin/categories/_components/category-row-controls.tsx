"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateCategory } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Per-row name/sortOrder edit + active toggle (SRCH-1). Same
// useTransition + inline error + router.refresh() pattern as
// UserManagementControls (src/app/admin/users/_components/
// user-management-controls.tsx). Slug never changes here — rename only
// ever touches `name` (the update action's patch has no slug field).
export function CategoryRowControls({
  categoryId,
  name,
  sortOrder,
  active,
}: {
  categoryId: number;
  name: string;
  sortOrder: number;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState(name);
  const [sortOrderValue, setSortOrderValue] = useState(String(sortOrder));

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

  function handleSave() {
    const patch: { name?: string; sortOrder?: number } = {};
    const trimmedName = nameValue.trim();
    if (trimmedName !== name) patch.name = trimmedName;
    const trimmedSortOrder = sortOrderValue.trim();
    if (trimmedSortOrder !== "") {
      const parsedSortOrder = Number(trimmedSortOrder);
      if (Number.isFinite(parsedSortOrder) && parsedSortOrder !== sortOrder) {
        patch.sortOrder = parsedSortOrder;
      }
    }
    if (Object.keys(patch).length === 0) return;
    run(() => updateCategory(categoryId, patch));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-40">
          <FieldLabel htmlFor={`name-${categoryId}`} className="sr-only">
            Name
          </FieldLabel>
          <Input
            id={`name-${categoryId}`}
            value={nameValue}
            disabled={isPending}
            onChange={(e) => setNameValue(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field className="w-20">
          <FieldLabel htmlFor={`sort-${categoryId}`} className="sr-only">
            Sort order
          </FieldLabel>
          <Input
            id={`sort-${categoryId}`}
            type="number"
            min={0}
            max={10_000}
            value={sortOrderValue}
            disabled={isPending}
            onChange={(e) => setSortOrderValue(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={handleSave}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(() => updateCategory(categoryId, { active: !active }))
          }
        >
          {active ? "Deactivate" : "Activate"}
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
