import "server-only";

import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export type Db = NodePgDatabase<typeof schema>;

// Deployed envs (Vercel + Neon) use the serverless websocket driver, which
// supports interactive transactions (neon-http does not — design §1, §8).
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
