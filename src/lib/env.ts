import "server-only";

import { z } from "zod";

// Validated once at first import (engineering.md: validate env at startup).
// Server-only: never import from client components.
//
// OAuth credentials are optional so the app boots before the per-env OAuth
// clients exist (FND-6); auth.ts only enables a provider when both its id
// and secret are set. CRON_SECRET / ANALYTICS_SALT_SEED / AI gateway vars
// become required when their features land (cron revalidation, analytics,
// moderation).
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),

  // Local only — deployed envs authenticate to the AI Gateway via Vercel OIDC.
  AI_GATEWAY_API_KEY: z.string().optional(),

  CRON_SECRET: z.string().min(16).optional(),
  ANALYTICS_SALT_SEED: z.string().min(16).optional(),

  COMMENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3),
  COMMENT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("Invalid environment variables — see errors above");
}

export const env = parsed.data;
