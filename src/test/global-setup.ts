import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { testDatabaseUrl } from "./db-url";

// Vitest globalSetup: runs in its own process, before workers. Applies
// migrations so the DB-backed suites see the current schema (idempotent).
// In CI any failure is fatal; locally EVERY failure only warns — a missing,
// unreachable, or misconfigured database degrades the DB-backed suites, and
// aborting here would take the DB-free unit tests down with it.
export default async function globalSetup() {
  try {
    const pool = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
    try {
      await migrate(drizzle(pool), {
        // Module-relative, not cwd-relative: vitest may be launched from
        // outside the repo root (IDE test explorers).
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url),
        ),
      });
    } finally {
      await pool.end();
    }
  } catch (err) {
    if (process.env.CI) throw err;
    console.warn(
      `⚠ Skipping test-database migrations: ${err instanceof Error ? err.message : String(err)} ` +
        "DB-backed tests will fail; DB-free tests still run. Start local Postgres with `pnpm db:up`.",
    );
  }
}
