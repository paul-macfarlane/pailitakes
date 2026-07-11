"use client";

import { createContext } from "react";

// Lets the edit page's lifecycle islands (post-pending/status/schedule
// controls, all under [id]/edit/_components) flush the sibling PostEditor's
// in-progress edits before publishing/discarding/transitioning/scheduling —
// none of those server actions see the editor's latest keystrokes otherwise
// (they only read the post row, which autosave writes to on its own 5s
// cadence). PostEditorSection provides this value (wrapping the editor's
// registered save + unload-suppression); it stays null outside that tree,
// which callers treat as "no flush available" (a no-op success).
export type EditorFlush = {
  // Runs the editor's save function explicitly; resolves true once the form
  // state as of THIS call has been persisted (or there was nothing to save),
  // false if it's blocked by validation, a server error, or a conflict.
  flush: () => Promise<boolean>;
  // One-shot suppression of the editor's beforeunload prompt, for a reload
  // the caller is about to trigger itself right after an explicit
  // publish/discard — see post-editor.tsx's unloadSuppressedRef.
  allowUnloadOnce: () => void;
};

export const EditorFlushContext = createContext<EditorFlush | null>(null);
