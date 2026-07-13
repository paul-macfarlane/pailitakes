"use client";

import { useEffect, useRef } from "react";

// Analytics beacon island (design §5.6, ANLY-3): fires once per pageview via
// navigator.sendBeacon — same-origin (no preflight) and survives page
// unload, unlike a plain fetch. Renders nothing; mounted at the end of a
// page's JSX so it never affects layout (see the client-ref-in-"use cache"
// island pattern on src/app/(public)/posts/[slug]/page.tsx).
export function ViewBeacon({
  path,
  postId,
}: {
  path: string;
  postId?: string;
}) {
  // Keyed by path+postId so React strict-mode's double-invoke (and any
  // re-render) never refires for the same mount, but a fresh client-side
  // navigation to a different page — a new mount — does.
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${path}|${postId ?? ""}`;
    if (firedForRef.current === key) return;
    firedForRef.current = key;

    if (typeof navigator.sendBeacon !== "function") return;

    // Fire-and-forget: the boolean return (queued vs. rejected) is
    // deliberately ignored — there's nothing actionable to do with it here.
    navigator.sendBeacon(
      "/api/view",
      new Blob([JSON.stringify({ path, postId })], {
        type: "application/json",
      }),
    );
  }, [path, postId]);

  return null;
}
