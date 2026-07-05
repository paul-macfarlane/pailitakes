import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5434/paulitakes",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
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

  it("coerces rate-limit overrides to numbers", async () => {
    const { env } = await importEnv({
      ...validEnv,
      COMMENT_RATE_LIMIT_PER_MINUTE: "5",
    });
    expect(env.COMMENT_RATE_LIMIT_PER_MINUTE).toBe(5);
  });
});
