"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CategoryOption } from "@/lib/categories/data";
import { SEARCH_QUERY_MAX } from "@/lib/posts/search-params";

const DEBOUNCE_MS = 300;

function buildHref(q: string, category: string | undefined) {
  const params = new URLSearchParams();
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  if (category) params.set("category", category);
  // Navigating from a filter change always resets pagination — dropping
  // `page` here is how that reset happens.
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

// GET <form action="/search"> so search works with JS disabled (a real
// submit, not just the debounced replace below). With JS, typing debounces
// into a router.replace instead of a full navigation/reload; the category
// select applies immediately (FR-3.3), no debounce needed for a discrete
// control.
export function SearchForm({
  q,
  category,
  categories,
}: {
  q: string;
  category: string | undefined;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Render-time state adjustment (React's documented alternative to a
  // resync effect — avoids react-hooks/set-state-in-effect) for when `q`
  // changes from outside this input: category select nav, pagination,
  // browser back/forward. Doesn't touch the debounce timer, so it can't
  // fire a redundant navigation — the debounce only ever starts from the
  // onChange handler below, never on mount or on a prop change.
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
    <form
      action="/search"
      method="get"
      className="flex flex-wrap items-end gap-3"
    >
      <Label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-normal">
        <span className="text-muted-foreground">Search</span>
        <Input
          type="search"
          name="q"
          value={value}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search posts…"
          maxLength={SEARCH_QUERY_MAX}
        />
      </Label>

      {/* Native <select>: this route is server-rendered with a soft nav on
          change (no client-side filtering), same rationale as the admin
          users list filter form — a shadcn Select would need a client
          island for no functional gain. */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Category</span>
        <select
          name="category"
          value={category ?? ""}
          onChange={(e) => {
            // Applies immediately (no debounce) — a discrete change should
            // not wait, and it must win over any in-flight query debounce.
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
            router.replace(buildHref(value, e.target.value || undefined));
          }}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
}
