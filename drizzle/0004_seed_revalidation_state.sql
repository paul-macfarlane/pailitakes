-- Custom SQL migration file, put your code below! --

-- Seed the singleton revalidation marker at migration (≈deploy) time so the
-- first ADM-9 cron run has a real last-run and processes crossings since
-- deploy, rather than establishing the marker and skipping that first window.
-- Idempotent: the fixed boolean PK means at most one row.
INSERT INTO "revalidation_state" ("id") VALUES (true) ON CONFLICT DO NOTHING;
