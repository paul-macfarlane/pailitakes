# Vercel Cron runbook (SEO-5 / ADM-9)

The app has exactly one cron: `GET /api/cron/revalidate`, run **once a day**
by Vercel Cron (design doc §5, "Scheduled publish/archive"). It revalidates
cache tags for posts whose `publish_at`/`archive_at` crossed since the last
run and normalizes stored statuses (`scheduled → published`, `→ archived`).

Cadence is a free choice (owner picked daily, 2026-07-14): public visibility
never waits on the cron — the read-time predicate plus the 60s ISR windows
put scheduled publishes/archives live within ~a minute on their own. The cron
only affects how quickly admin status badges catch up and how soon an
auto-archived post's staged draft is cleaned up. Daily also fits the Vercel
free-tier cron limits, which is why this replaced the original cron-job.org
plan.

## How it's wired

- **Config:** `vercel.json` → `crons: [{ path: "/api/cron/revalidate",
schedule: "0 6 * * *" }]`. Schedules are **UTC** (06:00 UTC ≈ 1–2am ET).
  Changing cadence = edit the schedule and deploy; there is nothing to click
  in the dashboard.
- **Auth:** the route requires `Authorization: Bearer <CRON_SECRET>`. Vercel
  sends that header automatically on cron invocations **because the env var
  is named `CRON_SECRET`** (Vercel's securing-crons convention). The var is
  already set per the [environments runbook](environments.md) §4. If it were
  ever unset, the route answers `503` (disabled, not open).
- **Production only:** Vercel Cron runs against the production deployment.
  The `staging` branch domain gets no cron invocations — acceptable, since
  nothing user-visible depends on it. If a stale admin badge on staging
  bothers you, hit the endpoint manually (curl below, staging URL + staging
  secret).

## Responses

- `200` `{"revalidated": n, "normalized": n, "ranAt": "..."}` — success.
- `401` `{"error": "Unauthorized."}` — wrong/missing bearer token.
- `503` `{"error": "Cron not configured."}` — `CRON_SECRET` unset in that env.

Timing is forgiving by design: the endpoint tracks its own last-run marker in
the DB, so a missed, late, or duplicated trigger is harmless (re-runs
reprocess idempotently). The very first run initializes the marker and
processes nothing — expected.

## Verify

After the next production deploy, the job appears in Vercel → Project →
Settings → Cron Jobs (run history under Observability → Cron Jobs; you can
also trigger it manually from there).

```sh
# 200 + JSON body with ranAt:
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.paulitakes.com/api/cron/revalidate

# 401 without the header proves auth is enforced:
curl -s -o /dev/null -w "%{http_code}\n" \
  https://www.paulitakes.com/api/cron/revalidate
```

End-to-end check: schedule a post a few minutes out in `/admin` and confirm
it appears on the home page and in `/sitemap.xml` within ~a minute of its
publish time (that's the 60s ISR window doing the work); after the next cron
run, its `/admin` badge should read "Published" and the cron response's
`normalized` count should reflect it.

## If a run fails

Nothing breaks visibly: public visibility is computed by the query predicate
at read time, and every cached page has a 60s ISR window as the safety net.
The cron only keeps admin status badges honest and cleans up staged drafts
on auto-archive. Check the failed run's logs under Observability → Cron
Jobs; the next successful run self-heals (it targets every currently-stale
row, not just the last window).
