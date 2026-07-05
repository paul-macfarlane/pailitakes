import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "@/lib/auth";

// Request-scoped session read for Server Components and server actions.
// cache() dedupes lookups within a single render pass.
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
