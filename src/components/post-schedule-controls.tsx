"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import {
  cancelScheduledArchive,
  scheduleArchive,
  schedulePublish,
} from "@/actions/posts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  canScheduleArchive,
  canSchedulePublish,
  type PostStatus,
} from "@/lib/post-status";

// Formats a Date as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants.
function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const subscribeNoop = () => () => {};

// Schedule future publish/archive times (ADM-5). Orthogonal to the editor's
// content autosave and to the immediate status buttons; visibility flips
// automatically when a scheduled time passes (design §4).
export function PostScheduleControls({
  postId,
  status,
  publishAt,
  archiveAt,
  pendingChanges = false,
}: {
  postId: string;
  status: PostStatus;
  publishAt: Date | null;
  archiveAt: Date | null;
  // Draft-of-published (ADR-0011): a public post with unpublished staged edits
  // can't be (re)scheduled until they're published or discarded (server rejects
  // it too). Disable the inputs/buttons and say why.
  pendingChanges?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // null = the field hasn't been edited yet → show the server value
  // (formatted to the viewer's timezone); a string is the user's own edit.
  const [publishEdit, setPublishEdit] = useState<string | null>(null);
  const [archiveEdit, setArchiveEdit] = useState<string | null>(null);

  // Hydration-safe mounted flag (server snapshot false, client true; same
  // idiom as ThemeToggle). Time-dependent values — local-TZ formatting and
  // `now` — must not render until mounted, or the server (UTC) and browser
  // (viewer TZ) disagree and hydration mismatches. Deriving them from
  // `mounted` during render keeps first client render identical to the server.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // A scheduled post whose publish time has passed is already live (§4);
  // offering "reschedule publish" would invite an accidental un-publish, and
  // the server rejects it anyway. (Only known after mount — `now` is
  // client-only.) Its archive control still applies.
  const scheduledLive =
    mounted &&
    status === "scheduled" &&
    publishAt !== null &&
    publishAt <= new Date();
  const showPublish = canSchedulePublish(status) && !scheduledLive;
  const showArchive = canScheduleArchive(status);
  if (!showPublish && !showArchive) return null;

  const minValue = mounted ? toDateTimeLocalValue(new Date()) : undefined;
  const publishValue =
    publishEdit ??
    (mounted && status === "scheduled" && publishAt
      ? toDateTimeLocalValue(publishAt)
      : "");
  const archiveValue =
    archiveEdit ??
    (mounted && archiveAt ? toDateTimeLocalValue(archiveAt) : "");

  const busy = isPending || pendingChanges;

  // Runs a scheduling action, surfacing its error or refreshing the page's
  // server data (status + timestamps) on success. Same isPending/try-catch
  // shape as PostStatusControls.
  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        // Drop local edits so both inputs fall back to the refreshed server
        // values — otherwise a just-canceled/rescheduled time lingers in the
        // field and could be re-submitted.
        setPublishEdit(null);
        setArchiveEdit(null);
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function submitPublish() {
    if (!publishValue) {
      setError("Pick a publish date and time.");
      return;
    }
    run(() => schedulePublish(postId, new Date(publishValue).toISOString()));
  }

  function submitArchive() {
    if (!archiveValue) {
      setError("Pick an archive date and time.");
      return;
    }
    run(() => scheduleArchive(postId, new Date(archiveValue).toISOString()));
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      {showPublish ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="schedule-publish" className="text-sm font-medium">
            Schedule publish
          </label>
          {mounted && status === "scheduled" && publishAt ? (
            <p className="text-sm text-muted-foreground">
              Scheduled to publish {publishAt.toLocaleString()}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="schedule-publish"
              type="datetime-local"
              className="w-auto"
              min={minValue}
              value={publishValue}
              disabled={busy}
              onChange={(event) => setPublishEdit(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={submitPublish}
            >
              {status === "scheduled" ? "Reschedule" : "Schedule"}
            </Button>
          </div>
        </div>
      ) : null}

      {showArchive ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="schedule-archive" className="text-sm font-medium">
            Schedule archive
          </label>
          {mounted && archiveAt ? (
            <p className="text-sm text-muted-foreground">
              Scheduled to archive {archiveAt.toLocaleString()}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="schedule-archive"
              type="datetime-local"
              className="w-auto"
              min={minValue}
              value={archiveValue}
              disabled={busy}
              onChange={(event) => setArchiveEdit(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={submitArchive}
            >
              {archiveAt ? "Reschedule" : "Schedule archive"}
            </Button>
            {archiveAt ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => cancelScheduledArchive(postId))}
              >
                Cancel archive
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={
          error
            ? "text-sm text-destructive"
            : pendingChanges
              ? "text-sm text-muted-foreground"
              : "sr-only"
        }
      >
        {error ??
          (pendingChanges
            ? "Publish or discard your pending changes first."
            : isPending
              ? "Saving…"
              : "")}
      </p>
    </div>
  );
}
