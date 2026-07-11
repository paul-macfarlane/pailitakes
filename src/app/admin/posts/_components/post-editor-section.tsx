"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
import { PostEditor } from "@/app/admin/posts/_components/post-editor";
import { Button } from "@/components/ui/button";
import type { EditablePost } from "@/lib/posts/admin";
import { cn } from "@/lib/utils";

// "Save now" and the autosave status live in the heading row — visible on
// load, next to the Preview link — rather than buried at the bottom of the
// form past the long body field. `children` (pending / status / schedule
// controls) render between the heading and the editor, so the heading stays
// at the very top.
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
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  const registerSave = useCallback((save: () => Promise<boolean>) => {
    saveRef.current = save;
  }, []);
  const onStatus = useCallback((next: string, isError: boolean) => {
    setStatus(next);
    setStatusIsError(isError);
  }, []);
  // Wraps the editor's registered save so the lifecycle islands (children)
  // can flush in-progress edits before publishing/discarding/transitioning/
  // scheduling — see EditorFlushContext.
  const flush = useCallback(() => saveRef.current(), []);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void saveRef.current()}
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

      <EditorFlushContext.Provider value={flush}>
        {children}
      </EditorFlushContext.Provider>

      <PostEditor
        // Defensive remount guard: if this section is ever reused across a
        // same-segment prop change (initialPost swapping from one post to
        // another, or to/from null) instead of a route change, the key forces
        // a fresh PostEditor/form instance rather than reusing stale state.
        key={initialPost?.id ?? "new"}
        categories={categories}
        initialPost={initialPost}
        registerSave={registerSave}
        onStatus={onStatus}
      />
    </>
  );
}
