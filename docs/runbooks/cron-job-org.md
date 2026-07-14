# cron-job.org setup runbook (SEO-5 / ADM-9)

The app has exactly one cron: `GET /api/cron/revalidate`, hit **once a day**
per environment by [cron-job.org](https://cron-job.org) (design doc §5,
"Scheduled publish/archive"). It revalidates cache tags for posts whose
`publish_at`/`archive_at` crossed since the last run and normalizes stored
statuses (`scheduled → published`, `→ archived`). One job per deployed
environment; local dev doesn't need one.

Cadence is a free choice (owner picked daily, 2026-07-14): public visibility
never waits on the cron — the read-time predicate plus the 60s ISR windows
put scheduled publishes/archives live within ~a minute on their own. The cron
only affects how quickly admin status badges catch up and how soon an
auto-archived post's staged draft is cleaned up, so run it as rarely as
you're happy with those lagging.

## What the endpoint expects

- **Method:** GET
- **Auth:** `Authorization: Bearer <CRON_SECRET>` header. `CRON_SECRET` is the
  per-environment Vercel env var from the
  [environments runbook](environments.md) §4 (`openssl rand -hex 16`; staging
  and prod use different values).
- **Responses:**
  - `200` `{"revalidated": n, "normalized": n, "ranAt": "..."}` — success.
  - `401` `{"error": "Unauthorized."}` — wrong/missing bearer token.
  - `503` `{"error": "Cron not configured."}` — `CRON_SECRET` unset in that
    environment (endpoint is disabled rather than open).
- **Timing is forgiving by design:** the endpoint tracks its own last-run
  marker in the DB, so a missed, late, or duplicated trigger is harmless
  (re-runs reprocess the same window idempotently). The very first run
  initializes the marker and processes nothing — expected.

## Create the jobs (one per environment)

For each of **prod** and **staging**, in cron-job.org → Create cronjob:

1. **Title:** `paulitakes revalidate (prod)` / `... (staging)`.
2. **URL:** `https://www.paulitakes.com/api/cron/revalidate` /
   `https://staging.paulitakes.com/api/cron/revalidate`.
3. **Schedule:** once daily (e.g. 06:00). Any cadence works — see the note
   above about what lags at lower frequencies.
4. **Advanced → Headers:** add `Authorization` =
   `Bearer <that environment's CRON_SECRET>` (include the word `Bearer` and
   the space).
5. **Advanced → Request method:** GET (default). Leave timeout at default
   (30s is plenty; the handler is a couple of indexed queries).
6. **Notifications:** enable failure notifications; treat any non-2xx as a
   failure. (A `401`/`503` streak means the secret and the Vercel env var
   have drifted — fix the env var or the header, not the schedule.)

## Verify

```sh
# 200 + JSON body with ranAt (repeat with the staging URL/secret):
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

## If cron-job.org is down or misfiring

Nothing breaks visibly: public visibility is computed by the query predicate
at read time, and every cached page has a 60s ISR window as the safety net.
The cron only keeps admin status badges honest and cleans up staged drafts
on auto-archive. Fix the job at leisure; the next successful run self-heals
(it targets every currently-stale row, not just the last window).
