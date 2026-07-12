"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import {
  deleteAnnouncement,
  updateAnnouncement,
} from "@/actions/announcements";
import {
  AnnouncementFormFields,
  announcementFormSchema,
  type AnnouncementFormValues,
} from "@/app/admin/announcements/_components/announcement-form-fields";
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
import { toDateTimeLocalValue } from "@/lib/shared/datetime";

// Per-row edit (inline form) and delete (AlertDialog confirm) for the admin
// announcements screen (ANN-2). Edit toggles between a compact controls row
// and AnnouncementEditForm; delete is always visible next to it.
export function AnnouncementRowControls({
  id,
  body,
  expiresAt,
}: {
  id: string;
  body: string;
  expiresAt: Date | null;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AnnouncementEditForm
        id={id}
        body={body}
        expiresAt={expiresAt}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setEditing(true)}
      >
        Edit
      </Button>
      <AnnouncementDeleteControl id={id} />
    </div>
  );
}

function AnnouncementEditForm({
  id,
  body,
  expiresAt,
  onCancel,
  onSaved,
}: {
  id: string;
  body: string;
  expiresAt: Date | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const form = useForm<AnnouncementFormValues>({
    resolver: standardSchemaResolver(announcementFormSchema),
    defaultValues: {
      body,
      expiresAt: expiresAt ? toDateTimeLocalValue(expiresAt) : "",
    },
  });

  async function onSubmit(values: AnnouncementFormValues) {
    const result = await updateAnnouncement(id, {
      body: values.body,
      expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
    });
    if (!result.ok) {
      form.setError("root", { message: result.error });
      return;
    }
    router.refresh();
    onSaved();
  }

  const rootError = form.formState.errors.root;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      <AnnouncementFormFields
        form={form}
        idPrefix={`edit-announcement-${id}`}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
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

function AnnouncementDeleteControl({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAnnouncement(id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isPending}
            />
          }
        >
          Delete
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes it from the site. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={handleConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
