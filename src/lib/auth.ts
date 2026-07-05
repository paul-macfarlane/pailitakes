import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
} from "@/lib/display-name";
import { env } from "@/lib/env";

// A provider is only enabled when its per-env OAuth client exists (design
// §7: dedicated clients per environment; env.ts leaves them optional so the
// app boots before FND-6 provisions them).
const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}
if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
  socialProviders.discord = {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
  };
}

export const enabledProviders = Object.keys(socialProviders) as Array<
  "google" | "discord"
>;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders,
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
        defaultValue: "reader",
        input: false,
      },
      bannedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
