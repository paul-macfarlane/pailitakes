"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { createAnnouncement } from "@/actions/announcements";
import {
  AnnouncementFormFields,
  announcementFormSchema,
  type AnnouncementFormValues,
} from "@/app/admin/announcements/_components/announcement-form-fields";
import { Button } from "@/components/ui/button";

const emptyValues: AnnouncementFormValues = { body: "", expiresAt: "" };

// New-announcement form (ANN-2). Same useForm + standardSchemaResolver +
// Field pattern as DisplayNameForm (ADR-0007); shares its fields with the
// inline edit form in AnnouncementRowControls via AnnouncementFormFields.
export function AnnouncementCreateForm() {
  const router = useRouter();
  const form = useForm<AnnouncementFormValues>({
    resolver: standardSchemaResolver(announcementFormSchema),
    defaultValues: emptyValues,
  });

  async function onSubmit(values: AnnouncementFormValues) {
    const result = await createAnnouncement({
      body: values.body,
      expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
    });
    if (!result.ok) {
      form.setError("root", { message: result.error });
      return;
    }
    form.reset(emptyValues);
    router.refresh();
  }

  const rootError = form.formState.errors.root;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="mb-6 flex flex-col gap-4 rounded-lg border p-4"
    >
      <AnnouncementFormFields form={form} idPrefix="new-announcement" />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="w-fit"
        >
          {form.formState.isSubmitting ? "Saving…" : "Post announcement"}
        </Button>
        {rootError ? (
          <p className="text-sm text-destructive" role="alert">
            {rootError.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
