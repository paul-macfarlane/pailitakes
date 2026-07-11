"use client";

import { createContext } from "react";

// Lets the edit page's lifecycle islands (post-pending/status/schedule
// controls, all under [id]/edit/_components) flush the sibling PostEditor's
// in-progress edits before publishing/discarding/transitioning/scheduling —
// none of those server actions see the editor's latest keystrokes otherwise
// (they only read the post row, which autosave writes to on its own 5s
// cadence). PostEditorSection provides this value (wrapping the editor's
// registered save); it stays null outside that tree, which callers treat as
// "no flush available" (a no-op success).
export const EditorFlushContext = createContext<
  (() => Promise<boolean>) | null
>(null);
