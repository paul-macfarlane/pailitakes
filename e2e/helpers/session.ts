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

export interface TestPost {
  id: string;
  slug: string;
  title: string;
  // Derived tag slugs, in the same order as the `tags` option — lets callers
  // hit /tags/[slug] without re-deriving the slug themselves. Empty when no
  // `tags` option was passed.
  tagSlugs: string[];
  cleanup: () => Promise<void>;
}

// Seeds a post row directly (bypassing the editor UI) for specs that only
// need an existing post to act on — e.g. post-delete.spec.ts drives the
// delete dialog, not the authoring flow that creates the row. Defaults to
// "published" with a past publishAt so it's immediately publicly visible
// (visiblePostsWhere, src/lib/posts/posts.ts). `bodyMd`/`tags` are optional
// so search-and-listing.spec.ts can seed a distinctive body word and tag for
// FTS/tag-page assertions without every other caller having to pass them.
export async function createTestPost(options: {
  authorId: string;
  categoryId: number;
  title?: string;
  status?: "draft" | "published";
  bodyMd?: string;
  tags?: string[];
}): Promise<TestPost> {
  const { databaseUrl } = requireEnv();
  const title = options.title ?? `E2E Post ${crypto.randomUUID().slice(0, 8)}`;
  const status = options.status ?? "published";
  const slug = `e2e-post-${crypto.randomUUID()}`;
  const bodyMd = options.bodyMd ?? "Seeded body for e2e.";

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const { rows } = await pool.query<{ id: string }>(
    `insert into posts (author_id, title, slug, body_md, thumbnail_url, category_id, status, publish_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      options.authorId,
      title,
      slug,
      bodyMd,
      "https://example.com/e2e-thumb.png",
      options.categoryId,
      status,
      status === "published" ? new Date(Date.now() - 1000) : null,
    ],
  );
  const id = rows[0]!.id;

  // Same onConflictDoNothing-then-select upsert idiom as setPostTags
  // (src/lib/posts/data.ts) — slugified locally (ASCII-only; e2e tag names
  // never carry diacritics) rather than importing tagToSlug, since this file
  // otherwise has no "@/..." dependency on the app source (only node/pg/dotenv).
  const tagSlugs: string[] = [];
  for (const name of options.tags ?? []) {
    const tagSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    await pool.query(
      `insert into tags (slug, name) values ($1, $2) on conflict (slug) do nothing`,
      [tagSlug, name],
    );
    const { rows: tagRows } = await pool.query<{ id: number }>(
      `select id from tags where slug = $1`,
      [tagSlug],
    );
    await pool.query(
      `insert into post_tags (post_id, tag_id) values ($1, $2)`,
      [id, tagRows[0]!.id],
    );
    tagSlugs.push(tagSlug);
  }

  return {
    id,
    slug,
    title,
    tagSlugs,
    cleanup: async () => {
      // post_tags cascades off posts (schema.ts); the tag row itself doesn't,
      // so drop it explicitly. Safe even if another post shares the tag slug
      // (won't happen here — tag names are per-test unique) since delete is
      // scoped to this test's own slugs.
      await pool.query(`delete from posts where id = $1`, [id]);
      if (tagSlugs.length > 0) {
        await pool.query(`delete from tags where slug = any($1)`, [tagSlugs]);
      }
      await pool.end();
    },
  };
}

export interface TestCategory {
  id: number;
  slug: string;
  name: string;
  cleanup: () => Promise<void>;
}

// Categories aren't seeded by any migration, and the post editor needs at
// least one to render. Seeds a uniquely-named, active category for authoring
// specs and removes it (and any posts that landed in it) afterwards. `slug`
// is a real (uuid-derived, not name-derived) DB value — search-and-listing
// specs use it directly for the home `?category=` filter, rather than
// re-deriving it from `name` with a duplicated slugify.
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
    slug,
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

// category-management.spec.ts creates categories through the real admin
// form (createCategory server action), not createTestCategory — there's no
// TestCategory.cleanup() to call. Sweeps rows by name prefix instead, so an
// afterEach still cleans up even if an earlier assertion in the test threw.
// Matching by prefix (not exact name) also catches a row after the spec's
// rename test changes its name, since rename only ever appends to the
// unique per-test prefix the name started with. Slug is untouched by rename
// (SRCH-1 invariant) but isn't derivable here without importing slugifyCore,
// so name is the simpler, sufficient match key.
export async function deleteCategoriesByPrefix(prefix: string): Promise<void> {
  const { databaseUrl } = requireEnv();
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `delete from posts where category_id in (select id from categories where name like $1)`,
    [`${prefix}%`],
  );
  await pool.query(`delete from categories where name like $1`, [`${prefix}%`]);
  await pool.end();
}
