"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEARCH_QUERY_MAX } from "@/lib/posts/search-params";

const DEBOUNCE_MS = 300;

function buildHref(q: string, category: string | undefined) {
  const params = new URLSearchParams();
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  if (category) params.set("category", category);
  // Navigating from a query change always resets pagination — dropping
  // `page` here is how that reset happens.
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

// GET <form action="/" method="get"> so search works with JS disabled (a
// real submit, not just the debounced replace below). With JS, typing
// debounces into a router.replace instead of a full navigation/reload.
// Category filtering is owned by CategoryPills now (no select here, per
// owner-approved fold of /search + /categories/[slug] into home, epic 03
// SRCH) — this island only ever edits `q`, carrying the current `category`
// through untouched: a hidden input for the no-JS submit path, `buildHref`
// for the JS debounce path.
export function SearchBox({
  q,
  category,
}: {
  q: string;
  category: string | undefined;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Render-time state adjustment (React's documented alternative to a
  // resync effect — avoids react-hooks/set-state-in-effect) for when `q`
  // changes from outside this input: pill navigation, pagination, browser
  // back/forward. Doesn't touch the debounce timer, so it can't fire a
  // redundant navigation — the debounce only ever starts from the onChange
  // handler below, never on mount or on a prop change.
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setValue(q);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  function handleQueryChange(next: string) {
    setValue(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // Already matches the URL (e.g. user typed then deleted back to the
      // same text) — nothing to navigate.
      if (next.trim() === q) return;
      router.replace(buildHref(next, category));
    }, DEBOUNCE_MS);
  }

  return (
    <form action="/" method="get" role="search">
      <Label htmlFor="home-search-q" className="sr-only">
        Search posts
      </Label>
      {/* No-JS fallback carries the active category filter through the
          submit; the JS debounce path carries it via buildHref instead. */}
      {category && <input type="hidden" name="category" value={category} />}
      <Input
        id="home-search-q"
        type="search"
        name="q"
        value={value}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search posts…"
        maxLength={SEARCH_QUERY_MAX}
      />
    </form>
  );
}
