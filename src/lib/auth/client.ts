import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { auth } from "@/lib/auth/auth";

// Client-side auth API (sign-in/out, session hook). Type-only import of the
// server config keeps the additional user fields (role, bannedAt) typed
// without crossing the server boundary.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
