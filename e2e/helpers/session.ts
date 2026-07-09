import crypto from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";

// Mints a real signed-in state for e2e specs without OAuth: inserts a user
// + session row and signs the session cookie the same way Better Auth does
// (`encodeURIComponent(`${token}.${base64(hmacSha256(secret, token))}`)`,
// cookie `better-auth.session_token`). Uses the same .env the dev server
// under test loads, so the signature verifies.
config({ quiet: true });

// The role column is server-managed (Better Auth marks it `input: false`), so
// specs that need staff/admin access set it directly on the seeded row here —
// the test-side equivalent of the promote-admin bootstrap script.
export type SeedRole = "reader" | "author" | "admin";

export interface TestSession {
  userId: string;
  userName: string;
  cookie: { name: string; value: string; domain: string; path: string };
  cleanup: () => Promise<void>;
}

function requireEnv(): { databaseUrl: string; secret: string } {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!databaseUrl || !secret) {
    throw new Error(
      "DATABASE_URL and BETTER_AUTH_SECRET must be set (see .env.example)",
    );
  }
  return { databaseUrl, secret };
}

function signSessionCookie(token: string, secret: string) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(token)
    .digest("base64");
  return {
    name: "better-auth.session_token",
    value: encodeURIComponent(`${token}.${signature}`),
    domain: "localhost",
    path: "/",
  };
}

export async function createTestSession(
  options: { userName?: string; role?: SeedRole } = {},
): Promise<TestSession> {
  const { userName = "E2E Tester", role = "reader" } = options;
  const { databaseUrl, secret } = requireEnv();

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const userId = `e2e-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `insert into "user" (id, name, email, role) values ($1, $2, $3, $4)`,
    [userId, userName, `${userId}@e2e.test`, role],
  );
  await pool.query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, $4)`,
    [`${userId}-session`, token, userId, expiresAt],
  );

  return {
    userId,
    userName,
    cookie: signSessionCookie(token, secret),
    cleanup: async () => {
      // posts.author_id has no ON DELETE (schema.ts — deleting an author with
      // posts should fail loudly), so drop this author's posts first (post_tags
      // cascade off posts); sessions cascade off the user.
      await pool.query(`delete from posts where author_id = $1`, [userId]);
      await pool.query(`delete from "user" where id = $1`, [userId]);
      await pool.end();
    },
  };
}

export interface TestUser {
  id: string;
  name: string;
  cleanup: () => Promise<void>;
}

// A bare user row (no session) for specs that need someone to act *on* — e.g.
// the admin user-management screen changing another user's role/ban.
export async function createTestUser(
  options: { name?: string; role?: SeedRole } = {},
): Promise<TestUser> {
  const { name = "E2E Subject", role = "reader" } = options;
  const { databaseUrl } = requireEnv();

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const id = `e2e-${crypto.randomUUID()}`;

  await pool.query(
    `insert into "user" (id, name, email, role) values ($1, $2, $3, $4)`,
    [id, name, `${id}@e2e.test`, role],
  );

  return {
    id,
    name,
    cleanup: async () => {
      await pool.query(`delete from posts where author_id = $1`, [id]);
      await pool.query(`delete from "user" where id = $1`, [id]);
      await pool.end();
    },
  };
}

export interface TestCategory {
  id: number;
  name: string;
  cleanup: () => Promise<void>;
}

// Categories aren't seeded by any migration, and the post editor needs at
// least one to render. Seeds a uniquely-named, active category for authoring
// specs and removes it (and any posts that landed in it) afterwards.
export async function createTestCategory(
  name = `E2E Category ${crypto.randomUUID().slice(0, 8)}`,
): Promise<TestCategory> {
  const { databaseUrl } = requireEnv();

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const slug = `e2e-cat-${crypto.randomUUID()}`;

  const { rows } = await pool.query<{ id: number }>(
    `insert into categories (slug, name, active) values ($1, $2, true) returning id`,
    [slug, name],
  );
  const id = rows[0]!.id;

  return {
    id,
    name,
    cleanup: async () => {
      // categories has no ON DELETE from posts either — clear referencing posts
      // first so cleanup is order-independent with session.cleanup().
      await pool.query(`delete from posts where category_id = $1`, [id]);
      await pool.query(`delete from categories where id = $1`, [id]);
      await pool.end();
    },
  };
}
