import "server-only";

import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";

import { env } from "@/lib/env";

import * as schema from "./schema";

const databaseUrl = env.DATABASE_URL;

export type Db = NodePgDatabase<typeof schema>;

// Deployed envs (Vercel + Neon) use the serverless websocket driver, which
// supports interactive transactions (neon-http does not — design §1, §8,
// ADR-0005). It relies on the global WebSocket available in Node >= 22 —
// enforced via package.json engines; do not lower that without adding a
// `ws`-based neonConfig.webSocketConstructor here.
// Locally we talk to Docker Postgres over TCP. Both expose the same Drizzle
// PgDatabase API, so the Neon variant is safely presented as Db.
export const db: Db = process.env.VERCEL
  ? (drizzleNeon({
      client: new NeonPool({ connectionString: databaseUrl }),
      schema,
    }) as unknown as Db)
  : drizzleNode({
      client: new PgPool({ connectionString: databaseUrl }),
      schema,
    });
