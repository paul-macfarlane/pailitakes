"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { PostEditor } from "@/components/post-editor";
import { Button } from "@/components/ui/button";
import type { EditablePost } from "@/lib/posts/admin";
import { cn } from "@/lib/utils";

// Heading toolbar + editor for the new/edit post pages. The "Save now" action
// and the autosave status live up here in the heading row — visible on load,
// next to the Preview link — rather than buried at the bottom of the form past
// the long body field. The editor (a sibling below) owns all autosave logic and
// hands its save fn + status up through registerSave/onStatus.
//
// `children` (the lifecycle controls: pending / status / schedule) render
// between the heading and the editor, so the heading stays at the very top.
export function PostEditorSection({
  heading,
  previewHref,
  categories,
  initialPost,
  children,
}: {
  heading: string;
  previewHref?: string;
  categories: { id: number; name: string }[];
  initialPost: EditablePost | null;
  children?: React.ReactNode;
}) {
  const [status, setStatus] = useState(
    initialPost ? "" : "Draft not saved yet",
  );
  const [statusIsError, setStatusIsError] = useState(false);
  const saveRef = useRef<() => void>(() => {});

  const registerSave = useCallback((save: () => void) => {
    saveRef.current = save;
  }, []);
  const onStatus = useCallback((next: string, isError: boolean) => {
    setStatus(next);
    setStatusIsError(isError);
  }, []);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveRef.current()}
          >
            Save now
          </Button>
          <p
            aria-live="polite"
            role={statusIsError ? "alert" : "status"}
            className={cn(
              "text-sm",
              statusIsError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {status}
          </p>
          {previewHref ? (
            <Link
              href={previewHref}
              target="_blank"
              rel="noopener"
              className="text-sm font-medium underline hover:text-foreground"
            >
              Preview
            </Link>
          ) : null}
        </div>
      </div>

      {children}

      <PostEditor
        categories={categories}
        initialPost={initialPost}
        registerSave={registerSave}
        onStatus={onStatus}
      />
    </>
  );
}
