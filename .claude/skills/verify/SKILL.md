---
name: verify
description: Build/launch/drive recipe for runtime-verifying changes in this repo (Next.js dev server + local Docker Postgres).
---

# Verifying paulitakes changes at runtime

## Launch

- DB: `docker compose ps` — container `paulitakes-db`, host port **5434**. Start with `npm run db:up`; apply pending migrations with `npm run db:migrate`.
- App: `npm run dev` (background), ready when `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` returns 200 (~5-15s).

## Drive

- **Public pages** are server-rendered — `curl` the route and grep the HTML; that IS the surface. Post pages: `/posts/{slug}`.
- **DB state setup** without going through the UI:
  `docker exec paulitakes-db psql -U paulitakes -d paulitakes -c "<sql>"`
  Reset any synthetic rows/values afterward — this is Paul's live dev data.
- **Caching gotcha:** public pages are `"use cache"` with `cacheLife({ stale: 60 })` even in dev. DB edits made _after_ a page was first served may not appear for up to 60s; set DB state **before** first request, or use a different slug per state.

## Auth-gated flows (`/admin/**`)

Drivable headlessly despite OAuth-only sign-in: `e2e/helpers/session.ts` mints a real signed session WITHOUT OAuth (inserts user + session rows, HMAC-signs the `better-auth.session_token` cookie with `BETTER_AUTH_SECRET` from `.env`). Two ways to use it:

- **Playwright** (preferred): specs in `e2e/` call `createTestSession({ role: "author" | "admin" })` and `context.addCookies([session.cookie])`. `npx playwright test <spec> -g "<title>"` — the config's `webServer` auto-starts the dev server. Helpers also seed categories/posts/users directly.
- **curl**: mint the cookie the same way (token row in `session` table + `better-auth.session_token=<urlencoded token.base64hmac>` cookie) to hit admin routes without a browser.

Always call the helper's `cleanup()` — seeded rows live in Paul's dev DB.

## Gotchas

- `.env` has `DATABASE_URL=postgres://paulitakes:paulitakes@localhost:5434/paulitakes`.
- Seeded/dev slugs to reuse for read-only checks: `seeded-take-1`.
