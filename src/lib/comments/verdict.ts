// Client-safe moderation types (no schema/server-only import) shared between
// the moderation service (writes mod_verdict) and admin moderation-log UI
// (reads it). ModerationVerdict mirrors Role's const-object + derived-union
// shape (src/lib/auth/roles.ts).

export const ModerationVerdict = {
  Allow: "allow",
  Flag: "flag",
} as const;
export type ModerationVerdict =
  (typeof ModerationVerdict)[keyof typeof ModerationVerdict];

// Audit record stored on every comment (design §5.2 step 5). The second arm
// captures a moderation call that errored/timed out — those fail closed to
// `held` (design §5.2 step 4) rather than getting a verdict at all.
export type ModVerdictRecord =
  | {
      verdict: ModerationVerdict;
      reason: string;
      model: string;
      latencyMs: number;
    }
  | {
      error: string;
      model: string;
      latencyMs: number;
    };
