"use client";

import { useEffect } from "react";

// Registers the <lite-youtube> custom element (and nothing else) on the
// client. Rendered once by any page that shows YouTube embeds — the
// YouTubeEmbed component and markdown bodies containing embeds both rely on
// it. Until (or unless) it runs, embeds degrade to their fallback link.
export function LiteYouTubeActivation() {
  useEffect(() => {
    // Side-effect import: customElements.define("lite-youtube", ...).
    // Module caching makes repeated mounts a no-op. On failure embeds keep
    // their fallback links — log the reason instead of an unhandled
    // rejection.
    import("lite-youtube-embed").catch((error: unknown) => {
      console.error("lite-youtube-embed failed to load", error);
    });
  }, []);

  return null;
}
