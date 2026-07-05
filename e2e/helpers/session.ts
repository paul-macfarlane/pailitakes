import crypto from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";

// Mints a real signed-in state for e2e specs without OAuth: inserts a user
// + session row and signs the session cookie the same way Better Auth does
// (`encodeURIComponent(`${token}.${base64(hmacSha256(secret, token))}`)`,
// cookie `better-auth.session_token`). Uses the same .env the dev server
// under test loads, so the signature verifies.
config({ quiet: true });

export interface TestSession {
  userName: string;
  cookie: { name: string; value: string; domain: string; path: string };
  cleanup: () => Promise<void>;
}

export async function createTestSession(
  userName = "E2E Tester",
): Promise<TestSession> {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!databaseUrl || !secret) {
    throw new Error(
      "DATABASE_URL and BETTER_AUTH_SECRET must be set (see .env.example)",
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const userId = `e2e-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    userName,
    `${userId}@e2e.test`,
  ]);
  await pool.query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, $4)`,
    [`${userId}-session`, token, userId, expiresAt],
  );

  const signature = crypto
    .createHmac("sha256", secret)
    .update(token)
    .digest("base64");

  return {
    userName,
    cookie: {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${token}.${signature}`),
      domain: "localhost",
      path: "/",
    },
    cleanup: async () => {
      // Sessions cascade on user delete.
      await pool.query(`delete from "user" where id = $1`, [userId]);
      await pool.end();
    },
  };
}
