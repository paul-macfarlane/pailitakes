"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Client-side fetching is the exception here, not the default (design §1/
// §5.3): server components/actions handle data by default, and this
// provider exists only for the few interactive islands whose data is
// deliberately uncached (design §3) — currently just comments. A new
// consumer should be able to justify the same tradeoff before reaching for
// this provider rather than a server component.
//
// Module-singleton QueryClient (not created per-render/per-mount): every
// consumer of this provider shares one client, so a page that mounts more
// than one island still shares cache/dedup instead of each spinning up its
// own.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reads are already no-store at the fetch layer; refetch on every
      // mount/focus instead of trusting a stale in-memory cache across
      // separate pages sharing this one singleton client.
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
