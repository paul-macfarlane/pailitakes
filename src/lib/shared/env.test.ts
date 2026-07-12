import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5434/paulitakes",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
};

async function importEnv(vars: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(vars)) {
    vi.stubEnv(key, value);
  }
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env validation", () => {
  it("accepts a minimal valid environment", async () => {
    const { env } = await importEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.COMMENT_RATE_LIMIT_PER_MINUTE).toBe(3);
    expect(env.COMMENT_RATE_LIMIT_PER_HOUR).toBe(30);
    expect(env.COMMENT_MODERATION_ENABLED).toBe(true);
    expect(env.COMMENT_MODERATION_MODEL).toBe("anthropic/claude-haiku-4.5");
    expect(env.COMMENT_AUTOBAN_REJECTED_THRESHOLD).toBe(5);
    expect(env.COMMENT_AUTOBAN_WINDOW_DAYS).toBe(7);
  });

  it("rejects a non-postgres DATABASE_URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      importEnv({ ...validEnv, DATABASE_URL: "mysql://localhost/nope" }),
    ).rejects.toThrow(/invalid environment/i);
  });

  it("rejects a short BETTER_AUTH_SECRET", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      importEnv({ ...validEnv, BETTER_AUTH_SECRET: "too-short" }),
    ).rejects.toThrow(/invalid environment/i);
  });

  it("rejects missing OAuth credentials", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      importEnv({ ...validEnv, GOOGLE_CLIENT_ID: "" }),
    ).rejects.toThrow(/invalid environment/i);
  });

  it("coerces rate-limit overrides to numbers", async () => {
    const { env } = await importEnv({
      ...validEnv,
      COMMENT_RATE_LIMIT_PER_MINUTE: "5",
    });
    expect(env.COMMENT_RATE_LIMIT_PER_MINUTE).toBe(5);
  });

  it("coerces auto-ban overrides to numbers", async () => {
    const { env } = await importEnv({
      ...validEnv,
      COMMENT_AUTOBAN_REJECTED_THRESHOLD: "3",
      COMMENT_AUTOBAN_WINDOW_DAYS: "14",
    });
    expect(env.COMMENT_AUTOBAN_REJECTED_THRESHOLD).toBe(3);
    expect(env.COMMENT_AUTOBAN_WINDOW_DAYS).toBe(14);
  });

  it("rejects a non-positive COMMENT_AUTOBAN_REJECTED_THRESHOLD", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      importEnv({ ...validEnv, COMMENT_AUTOBAN_REJECTED_THRESHOLD: "0" }),
    ).rejects.toThrow(/invalid environment/i);
  });

  it("parses COMMENT_MODERATION_ENABLED='false' to boolean false", async () => {
    const { env } = await importEnv({
      ...validEnv,
      COMMENT_MODERATION_ENABLED: "false",
    });
    expect(env.COMMENT_MODERATION_ENABLED).toBe(false);
  });

  it("rejects an invalid COMMENT_MODERATION_ENABLED value", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      importEnv({ ...validEnv, COMMENT_MODERATION_ENABLED: "not-a-bool" }),
    ).rejects.toThrow(/invalid environment/i);
  });
});
