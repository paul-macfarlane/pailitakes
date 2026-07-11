-- Custom SQL migration file, put your code below! --

-- Seed the FR-2.1 initial category set at migration (≈deploy) time so the
-- admin/author pickers and public category index are never empty on a fresh
-- environment. Idempotent via the unique "slug" constraint: safe to re-run
-- (e.g. across environments that already have these rows) and never
-- overwrites an admin's later rename (slug is stable across rename; SRCH-1).
INSERT INTO "categories" ("slug", "name", "sort_order") VALUES
  ('nfl', 'NFL', 0),
  ('nba', 'NBA', 1),
  ('mlb', 'MLB', 2),
  ('college-football', 'College Football', 3)
ON CONFLICT ("slug") DO NOTHING;
