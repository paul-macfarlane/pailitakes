import { readFileSync } from "node:fs";

import { parse } from "dotenv";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Tests migrate and write to the database they're pointed at, so they refuse
// anything but a local host — an ambient DATABASE_URL left over from e.g.
// debugging against Neon staging must never be migrated/seeded by
// `pnpm test`. No CI exemption: CI's DATABASE_URL is the localhost service
// container, and an env-var escape hatch (CI=true) would disable the guard
// exactly when developers reproduce CI locally.
function assertLocalHost(url: string, source: string): string {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run DB-backed tests against non-local host "${host}" (from ${source}). ` +
        "Tests apply migrations and write rows; point DATABASE_URL at local Postgres (`pnpm db:up`) or unset it.",
    );
  }
  return url;
}

// CI provides DATABASE_URL in process.env; locally we read it from .env
// WITHOUT mutating process.env (mutating it would break env.test.ts
// assertions that rely on defaults).
export function testDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return assertLocalHost(process.env.DATABASE_URL, "process.env");
  }
  let raw: string;
  try {
    raw = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch {
    throw new Error(
      "DATABASE_URL is not set and .env was not found. DB-backed tests need local Postgres: run `pnpm db:up`.",
    );
  }
  const url = parse(raw).DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing from .env");
  return assertLocalHost(url, ".env");
}
