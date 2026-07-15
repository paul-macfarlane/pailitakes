import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { Role } from "@/lib/auth/roles";
import { env } from "@/lib/shared/env";
import {
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
} from "@/lib/users/display-name";
import { prepareAccountDeletion } from "@/lib/users/service";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Per-env OAuth clients (design §7); creds are required by env.ts, so
  // both providers are always enabled.
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    user: {
      // Server-side name constraints — the account form's maxLength is UX,
      // not a boundary. Create clamps provider-supplied names; update
      // rejects invalid input outright.
      create: {
        before: async (user) => ({
          data: {
            ...user,
            name: (normalizeDisplayName(user.name) ?? "Sports Fan").slice(
              0,
              MAX_DISPLAY_NAME_LENGTH,
            ),
          },
        }),
      },
      update: {
        before: async (data) => {
          if (typeof data.name === "string") {
            const name = normalizeDisplayName(data.name);
            if (!name || name.length > MAX_DISPLAY_NAME_LENGTH) {
              throw new APIError("BAD_REQUEST", {
                message: `Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters.`,
              });
            }
            return { data: { ...data, name } };
          }
          return { data };
        },
      },
    },
  },
  user: {
    additionalFields: {
      // Managed server-side only (seed script / admin actions), never
      // settable through auth API input.
      role: {
        type: "string",
        required: false,
        defaultValue: Role.Reader,
        input: false,
      },
      bannedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
    // Self-service account deletion (ACCT-1). beforeDelete is the single
    // enforcement point for the refusal rules (authored posts, would-orphan-
    // admins) and for anonymizing the user's comments — better-auth calls it
    // synchronously before internalAdapter.deleteUser, so throwing here
    // aborts the delete before any row is removed. Client freshness note:
    // the /delete-user endpoint itself (not this hook) rejects a stale
    // session with APIError(BAD_REQUEST, SESSION_EXPIRED) — see ACCT-1
    // handoff notes for the exact string.
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        const result = await prepareAccountDeletion(user.id);
        if (!result.ok) {
          throw new APIError("BAD_REQUEST", { message: result.error });
        }
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
