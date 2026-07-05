"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import {
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
} from "@/lib/display-name";

const displayNameSchema = z.object({
  name: z
    .string()
    .refine(isValidDisplayName, {
      message: `Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters.`,
    }),
});

type DisplayNameValues = z.infer<typeof displayNameSchema>;

export function DisplayNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const form = useForm<DisplayNameValues>({
    resolver: standardSchemaResolver(displayNameSchema),
    defaultValues: { name: initialName },
  });

  async function onSubmit(values: DisplayNameValues) {
    setSaved(false);
    // Schema guarantees normalizeDisplayName succeeds here.
    const name = normalizeDisplayName(values.name)!;
    const { error } = await authClient.updateUser({ name });
    if (error) {
      form.setError("root", {
        message: "Couldn't save your name. Please try again.",
      });
      return;
    }
    setSaved(true);
    form.reset({ name });
    router.refresh();
  }

  const nameError = form.formState.errors.name;
  const rootError = form.formState.errors.root;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
        <Input
          id="display-name"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          aria-invalid={nameError ? true : undefined}
          {...form.register("name", {
            onChange: () => setSaved(false),
          })}
        />
        <FieldDescription>Shown on your comments.</FieldDescription>
        {nameError ? <FieldError>{nameError.message}</FieldError> : null}
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save"}
        </Button>
        {saved ? (
          <p className="text-sm text-muted-foreground" role="status">
            Saved.
          </p>
        ) : null}
        {rootError ? (
          <p className="text-sm text-destructive" role="alert">
            {rootError.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
