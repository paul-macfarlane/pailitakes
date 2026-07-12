"use client";

import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementInputSchema,
} from "@/lib/announcements/input";

// `expiresAt` here is the raw <input type="datetime-local"> string (empty =
// none); the create/edit submit handlers convert it to `Date | null` before
// calling the server action, which is what the action's expiresAt schema
// (z.coerce.date().nullable()) expects.
export const announcementFormSchema = announcementInputSchema.extend({
  expiresAt: z.string(),
});

export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;

// Body/expiresAt fields shared between AnnouncementCreateForm and the inline
// edit form in AnnouncementRowControls (ANN-2) — same schema and shape,
// only the surrounding chrome (heading, submit handler, cancel) differs.
// `idPrefix` keeps input ids unique when multiple rows are open/editing at
// once.
export function AnnouncementFormFields({
  form,
  idPrefix,
}: {
  form: UseFormReturn<AnnouncementFormValues>;
  idPrefix: string;
}) {
  const bodyError = form.formState.errors.body;
  const expiresAtError = form.formState.errors.expiresAt;
  const body = form.watch("body") ?? "";

  return (
    <>
      <Field data-invalid={bodyError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-body`}>Announcement</FieldLabel>
        <Textarea
          id={`${idPrefix}-body`}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          aria-invalid={bodyError ? true : undefined}
          {...form.register("body")}
        />
        <FieldDescription>
          {body.length}/{ANNOUNCEMENT_MAX_LENGTH}
        </FieldDescription>
        {bodyError ? <FieldError>{bodyError.message}</FieldError> : null}
      </Field>
      <Field data-invalid={expiresAtError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-expires-at`}>Expires at</FieldLabel>
        <Input
          id={`${idPrefix}-expires-at`}
          type="datetime-local"
          aria-invalid={expiresAtError ? true : undefined}
          {...form.register("expiresAt")}
        />
        <FieldDescription>
          Optional. The announcement disappears after this time.
        </FieldDescription>
        {expiresAtError ? (
          <FieldError>{expiresAtError.message}</FieldError>
        ) : null}
      </Field>
    </>
  );
}
