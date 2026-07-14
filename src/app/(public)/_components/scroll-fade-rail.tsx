"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// Edge-fade masks, keyed to which direction currently has overflow. mask-image
// (unlike a gradient overlay) is color-agnostic — same fade in light and dark
// mode with no theme-token plumbing (SEO-7).
const FADE_RIGHT =
  "[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]";
const FADE_LEFT =
  "[mask-image:linear-gradient(to_right,transparent,black_2.5rem)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_2.5rem)]";
const FADE_BOTH =
  "[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]";

// Horizontally-scrollable rail with an edge fade that reveals which
// direction(s) still have overflow — mobile-first discoverability for the
// home category pill rail (FR-9.4, SEO-7). Generic pass-through so it isn't
// coupled to pills specifically, but deliberately not configurable beyond
// that: no fade-width/direction props, no context.
export function ScrollFadeRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  // Starts false/false (no mask) to match the unhydrated server render, then
  // the mount effect below corrects it — avoids a hydration-mismatch flash.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;

    // Reads only the three scroll metrics per call, and bails out of the
    // state update when neither boolean actually changed — keeps
    // scroll-driven updates cheap (no layout thrash, no redundant renders).
    function measure() {
      if (!el) return;
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setCanScrollLeft((prev) => (prev === left ? prev : left));
      setCanScrollRight((prev) => (prev === right ? prev : right));
    }

    measure();

    el.addEventListener("scroll", measure, { passive: true });
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", measure);
      resizeObserver.disconnect();
    };
  }, []);

  const fadeClass = canScrollLeft
    ? canScrollRight
      ? FADE_BOTH
      : FADE_LEFT
    : canScrollRight
      ? FADE_RIGHT
      : undefined;

  return (
    <div
      ref={railRef}
      className={cn("snap-x scroll-px-4 overflow-x-auto", fadeClass, className)}
    >
      {children}
    </div>
  );
}
