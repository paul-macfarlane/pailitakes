# Environment setup runbook (FND-6)

Target state: technical-design.md §7. **Status: complete (2026-07-05)** — all
steps below are provisioned (Vercel project + GitHub connection, Neon
branches, GitHub migration secrets, per-env OAuth clients, Vercel env vars,
`staging` branch). Kept as the reference for how the environments are wired
and for re-provisioning.

- Vercel project `paulitakes` linked (`.vercel/project.json`, gitignored);
  GitHub repo `paul-macfarlane/pailitakes` connected (auto-deploys, PR previews).
- CI (`.github/workflows/ci.yml`) + branch-scoped migrations
  (`.github/workflows/migrate.yml`).
- Local env: Docker Postgres 18 (`pnpm db:up`, host port 5434), `.env` from
  `.env.example`.
- Git flow: feature branches off `staging`, PRs → `staging`, `staging` → `main`.

## 1. Neon
1. Create a Neon project (Postgres **18** to match `docker-compose.yml`).
2. `main` branch = prod. Create a persistent `staging` branch.
3. Copy the two pooled connection strings.

## 2. GitHub secrets (for migrate.yml)
- `STAGING_DATABASE_URL` = Neon `staging` branch URL
- `PROD_DATABASE_URL` = Neon `main` branch URL

## 3. Git staging branch
After the foundation PR merges: create long-lived `staging` from `main`
(`git checkout -b staging main && git push -u origin staging`). PRs merge to
`staging`; `staging` merges to `main` (design §7 — no per-PR databases).

## 4. Vercel environment variables
Production (main) and Preview scoped to the `staging` branch:

| Var | Prod | Staging |
|---|---|---|
| `DATABASE_URL` | Neon main URL | Neon staging URL |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (unique) | unique value |
| `BETTER_AUTH_URL` | `https://paulitakes.com` | `https://staging.paulitakes.com` |
| `GOOGLE_CLIENT_ID/SECRET` | prod client | staging client |
| `DISCORD_CLIENT_ID/SECRET` | prod client | staging client |
| `CRON_SECRET` | `openssl rand -hex 16` | same approach |
| `ANALYTICS_SALT_SEED` | `openssl rand -hex 16` | same approach |

`AI_GATEWAY_API_KEY` is local-only — deployed envs use Vercel OIDC.

## 5. Domains
- Prod: `paulitakes.com` → Vercel project (DNS at your registrar).
- Staging: assign `staging.paulitakes.com` to the `staging` git branch in
  Vercel → Project → Domains (stable URL so OAuth redirects can be
  registered ahead of time).

## 6. OAuth clients (one per environment; never shared)
Redirect URI is `{BETTER_AUTH_URL}/api/auth/callback/{provider}`.

- **Google** (console.cloud.google.com → APIs & Services → Credentials):
  3 OAuth clients (local `http://localhost:3000/...`, staging, prod).
- **Discord** (discord.com/developers/applications): 3 applications with the
  same redirect pattern.
- Put local creds in `.env`; staging/prod creds in Vercel env vars (step 4).

## 7. Verify
- Push to `staging` → migrate.yml applies migrations, Vercel deploys, sign-in
  works with both providers on `staging.paulitakes.com`.
- Repeat for `main`/prod, then run `pnpm db:promote-admin <email>` against
  prod (`DATABASE_URL=<prod url> pnpm db:promote-admin ...`) after first
  sign-in.
