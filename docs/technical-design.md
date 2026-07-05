# Paulitakes — Technical Design

**Version:** 0.3 (Locked; amended by ADR-0004)
**Owner:** Paul
**Last updated:** July 5, 2026
**Companion doc:** Paulitakes Product Doc v0.2

---

## 1. Stack Summary

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router)** | SSR/ISR for public pages, server actions for mutations |
| Hosting | **Vercel** | Image handling, AI Gateway |
| Scheduler | **cron-job.org** | External cron hitting a secret-protected endpoint every 5 min (free at this frequency; Vercel Cron on Hobby is once/day) |
| Database | **Neon Postgres** (prod/staging), **Docker Postgres** (local) | Serverless driver in deployed envs |
| ORM | **Drizzle** | Schema-as-code, migrations via drizzle-kit |
| Auth | **Better Auth** | Google + Discord OAuth, Drizzle adapter, role field |
| Styling | **Tailwind CSS + shadcn/ui** | shadcn chart components wrap Recharts |
| Client data | **TanStack Query** (comments + admin dashboard only) | Likes use server actions + `useOptimistic`; beacon is plain `sendBeacon` |
| Markdown | **unified** (remark/rehype) | Server-side render, sanitized, YouTube embed transform |
| Thumbnails | **External public URLs** | No storage in v1; `next/image` with `unoptimized`; Vercel Blob later if uploads wanted |
| Moderation | **Claude Haiku via Vercel AI Gateway** | AI SDK, model `anthropic/claude-haiku-4.5`; OIDC auth on Vercel (no key mgmt); optional fallback model; $5/mo included credits cover this workload |
| Search | **Postgres FTS** | Generated `tsvector` + GIN index |
| Analytics | **Self-hosted in Postgres** | Beacon endpoint + `page_views` table |
| Charts | **Recharts** (via shadcn/ui charts) | Admin analytics dashboard |

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │              Next.js on Vercel          │
                    │                                         │
 Visitors ────────▶ │  Public pages (RSC + ISR, tag-cached)   │
                    │   home / posts / categories / tags /    │
                    │   search / sitemap                      │
                    │                                         │
 Readers ─────────▶ │  Client islands                         │
                    │   comments (TanStack Query),            │
                    │   likes (useOptimistic + action),       │
                    │   view beacon (sendBeacon)              │
                    │                                         │
 Authors/Admin ───▶ │  /admin (dynamic, role-gated)           │
                    │   editor, dashboard, analytics,         │
                    │   moderation log, announcements         │
                    │                                         │
                    │  Route handlers + server actions        │
                    │  /api/cron ◀── cron-job.org (5 min)     │
                    └──────┬──────────────┬───────────────────┘
                           │              │
                    Neon Postgres    Vercel AI Gateway → Haiku
                    (Drizzle)        (comment moderation)
```

### Rendering strategy per route

| Route | Strategy |
|---|---|
| `/` (home) | ISR, `revalidate: 60`, cache tags `post-list`, `announcements` |
| `/posts/[slug]` | ISR per-slug, cache tag `post:{slug}`; comments + likes hydrate client-side |
| `/categories/[slug]`, `/tags/[slug]` | ISR, `revalidate: 60`, tag `post-list` |
| `/search` | Dynamic (query-dependent), never cached |
| `/admin/**` | Fully dynamic, `noindex`, role-gated in middleware + per-action checks |
| `/sitemap.xml` | Route handler, tag `post-list` |

**Key pattern:** post pages are cached static shells; user-specific or fast-changing data (comment tree, like state, view beacon) lives in small client components. Public pages stay fast and cheap, and a new comment never triggers a page rebuild.

---

## 3. Caching Strategy

Four layers, each with a distinct job:

1. **Full Route Cache + Vercel CDN.** ISR pages render once and serve as cached HTML from the edge. Invalidated by (a) time — `revalidate: 60` regenerates in the background at most once per minute, stale-while-revalidate, so no visitor ever waits — or (b) on-demand invalidation from server actions.
2. **Tag-based on-demand invalidation.** Pages declare cache tags (`post:{slug}`, `post-list`, `announcements`). Publish/edit/archive/announcement actions call `revalidateTag(...)`, which correctly invalidates the post page, home, category/tag listings, and sitemap in one shot — no path enumeration to forget.
3. **Time as the scheduled-publish safety net.** Visibility is a query predicate (§4), so a scheduled post becomes queryable at `publish_at` automatically; the next time-based regeneration (≤60s later) surfaces it. The 5-minute cron (cron-job.org) makes it exact by revalidating tags when any `publish_at`/`archive_at` crosses.
4. **Deliberately uncached:** `/search`, `/admin/**`, and all comment/like reads (client-fetched, `no-store`). Interactive data freshness is TanStack Query's job, not Next's cache.

---

## 4. Data Model

Better Auth manages `user`, `session`, `account`, `verification` tables via its Drizzle adapter. We extend `user` with `role` (`reader` | `author` | `admin`, default `reader`) and `banned_at` (nullable).

### Application tables

```
categories
  id            serial PK
  slug          text unique
  name          text
  active        boolean default true
  sort_order    int

posts
  id            uuid PK
  author_id     text FK -> user.id
  title         text
  slug          text unique
  body_md       text
  thumbnail_url text                    -- external public image URL (v1)
  video_url     text null               -- associated YouTube URL
  category_id   int FK -> categories.id
  status        enum('draft','scheduled','published','archived')
  comments_locked boolean not null default false  -- admin lock (FR-4.4); ADR-0004
  publish_at    timestamptz null
  archive_at    timestamptz null
  created_at    timestamptz
  updated_at    timestamptz
  search        tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', title), 'A') ||
                  setweight(to_tsvector('english', body_md), 'B')
                ) STORED                -- GIN index; Postgres derives &
                                        -- maintains this on every write

-- Excerpts are not stored: derived at render time from body_md
-- (strip markdown, first ~160 chars).

tags
  id            serial PK
  slug          text unique
  name          text

post_tags
  post_id       uuid FK -> posts.id
  tag_id        int  FK -> tags.id
  PK (post_id, tag_id)

comments
  id            uuid PK
  post_id       uuid FK -> posts.id
  author_id     text FK -> user.id
  parent_id     uuid FK -> comments.id null   -- null = top level
  body          text
  status        enum('visible','held','rejected','deleted')
  mod_verdict   jsonb null              -- { verdict, reason, model, latency_ms }
  created_at    timestamptz
  edited_at     timestamptz null
  INDEX (post_id, created_at), INDEX (status, created_at)

post_likes
  post_id       uuid FK -> posts.id
  user_id       text FK -> user.id
  created_at    timestamptz
  PK (post_id, user_id)

comment_likes
  comment_id    uuid FK -> comments.id
  user_id       text FK -> user.id
  created_at    timestamptz
  PK (comment_id, user_id)

announcements
  id            uuid PK
  body          text                    -- ≤500 chars, minimal markdown
  expires_at    timestamptz null
  created_at    timestamptz
  updated_at    timestamptz

page_views
  id            bigserial PK
  post_id       uuid FK -> posts.id null   -- null = non-post page
  path          text
  visitor_hash  text                    -- salted daily hash, no PII (§8)
  created_at    timestamptz
  INDEX (post_id, created_at), INDEX (created_at)
```

### Public visibility is a query, not a job

A post is publicly visible iff:

```sql
status IN ('published','scheduled')
AND publish_at <= now()
AND (archive_at IS NULL OR archive_at > now())
```

"Publish now" sets `status='published', publish_at=now()`. "Schedule" sets `status='scheduled'` with a future `publish_at` — the post becomes visible at that instant with **no job required**. Scheduled archive works identically via `archive_at`. A helper (`visiblePostsWhere()`) encapsulates the predicate for every public query and search. A nightly cleanup can normalize statuses purely for admin-list readability.

The only cron (cron-job.org hitting `/api/cron/revalidate` every 5 min): find posts whose `publish_at`/`archive_at` crossed since the last run → `revalidateTag` for the affected post, `post-list`, and sitemap. The endpoint should be idempotent and track "last run" in the DB rather than trusting call timing, so a missed or duplicated trigger is harmless.

---

## 5. Key Flows

### 5.1 Markdown pipeline

Server-side in the post page RSC (captured by ISR, so it runs once per revalidation, not per request):

```
remark-parse → remark-gfm → remark-rehype
  → rehype-sanitize (strict schema; allowlist iframe only for youtube.com/youtube-nocookie.com)
  → custom rehype plugin: bare YouTube URLs / links → responsive embed
  → rehype-pretty-code (optional, code blocks)
  → rehype-stringify
```

The associated `video_url` renders as an embed component below the title, independent of the body pipeline. Use `youtube-nocookie.com` with a click-to-load facade (lite-youtube pattern) — eager YouTube iframes wreck mobile load performance.

### 5.2 Comment creation (moderation + rate limiting)

```
POST comment (server action, authed)
 1. Reject if user banned, post archived, or comments locked
 2. Rate limit (two Postgres counts on comments by author_id):
      > 3 in last minute  → error
      > 30 in last hour   → error
      (values in env/config)
 3. Moderate via AI SDK → Vercel AI Gateway → anthropic/claude-haiku-4.5
      strict JSON verdict: { "verdict": "allow" | "flag", "reason": "..." }
      gateway-level fallback model optional; ~5s timeout
 4. Insert comment:
      allow        → status 'visible'   (appears immediately)
      flag         → status 'rejected'  (final; user sees brief rejection
                                          message; never published)
      error/timeout→ status 'held'      (fail-closed; user told it's
                                          pending review)
 5. mod_verdict jsonb stored on every comment for audit
```

**Moderation log (admin):** all `rejected` and `held` comments are browsable with the model's verdict and reasoning. Its purpose is *monitoring*, not an approval workflow — rejections are final by default. `held` items (LLM failures only) await an approve/delete decision; a restore action also exists on `rejected` for clear false positives.

**Moderation policy (finalized):**
- **Flag:** NSFW/sexual content; any profanity (family-friendly standard — judge the *words*, not the intensity of the take); slurs; targeted personal attacks on other commenters; spam/scam/malicious links.
- **Allow:** heated sports takes, trash talk, and harsh criticism of players, teams, coaches, and takes — provided the language stays clean; insults that are clearly banter rather than targeted attacks; links generally (any domain), unless spammy or malicious.
- The prompt must state explicitly that intensity/negativity alone is never a reason to flag — only the categories above — or an eager classifier will flag half the comment section during rivalry week. Keep a few-shot example set in the repo pairing allowed heated comments against flagged equivalents (same take ± profanity is a great contrast pair).

Cost: Haiku on a ~100-token comment is a fraction of a cent; Vercel's included monthly AI Gateway credits cover this workload outright, and the gateway adds zero token markup.

### 5.3 Comment tree

One query per post via a route handler (`GET /api/comments?postId=...`, `no-store`) — reads go through GET route handlers so TanStack Query can fetch/refetch freely, while writes stay in server actions. `WHERE post_id = ? AND status IN ('visible','deleted')`, tree assembled in memory by `parent_id`. `deleted` comments render as "[deleted]" placeholders only when they have visible descendants. UI indents to depth ~5, then flattens with "replying to @name" labels (critical on phone widths). Fetched and mutated via TanStack Query with optimistic inserts on `allow` — the one island complex enough to earn the dependency.

### 5.4 Likes

Server action toggling insert/delete on the composite-PK like tables (idempotent by construction), wired to `useOptimistic` on the client — no client fetching library involved. Counts via `COUNT(*)` at read time; initial like state and counts are fetched alongside the comment tree (comments) or inlined in a tiny dynamic fetch (post like button). Banned users blocked at the action level.

### 5.5 Search

```sql
SELECT ..., ts_rank(search, q) AS rank
FROM posts, websearch_to_tsquery('english', $1) q
WHERE <visiblePostsWhere()>
  AND (search @@ q
       OR EXISTS (tag match ILIKE)
       OR category name ILIKE)
ORDER BY rank DESC, publish_at DESC
```

`websearch_to_tsquery` gives forgiving, Google-ish syntax. Snippets via `ts_headline`. Optional `category` param ANDs a category filter (FR-3.3). Dynamic route, debounced input.

### 5.6 Analytics

**Ingest:** a tiny client component on every public page fires `navigator.sendBeacon('/api/view', { path, postId? })` once per pageview. The handler computes `visitor_hash = sha256(daily_salt + ip + user_agent)` and inserts a row. The salt rotates daily — hashes can't be correlated across days and no raw IP/UA is stored. Basic bot filtering: drop known bot UAs; the beacon requiring JS filters most scrapers.

**Dashboard (admin):** shadcn/ui chart components (Recharts) over aggregate queries — traffic over time (`count(*)` + `count(distinct visitor_hash)` by day/week/month), top posts, views by category, per-post views, engagement (comments/likes per post, most-liked). Raw rows + indexed aggregates are instant at this scale; a nightly rollup table is deliberately deferred until needed.

### 5.7 Admin & authoring

- **Access:** middleware redirects non-author/admin from `/admin/**`; every server action re-checks role (middleware is UX, action checks are the security boundary). Authors scoped to `author_id = self`; admin unscoped.
- **Editor:** Markdown textarea + toggleable preview pane running the *same* rendering pipeline as production (server action returns rendered HTML) — guarantees preview fidelity (FR-7.2). Autosave drafts on interval.
- **Thumbnails:** a URL field. Rendered with `next/image` + `unoptimized` + explicit dimensions (avoids maintaining a `remotePatterns` allowlist / open-proxy risk while keeping lazy loading and layout stability). Known tradeoffs: link rot and hotlink-blocking hosts. Revisit with Vercel Blob if uploads are ever wanted.
- **Moderation log, announcements, categories, users (roles/bans):** simple CRUD screens.
- **Preview:** `/admin/preview/[id]` renders any draft/scheduled post with the public layout, auth-gated.

### 5.8 SEO & sharing

- Metadata API per post: title, description (derived excerpt), canonical URL
- `og:image` = post thumbnail URL (FR-1.4); optionally a branded `next/og` card later
- `sitemap.xml` route handler over visible posts, revalidated by tag
- `robots.txt` disallows `/admin`

---

## 6. Project Structure (sketch)

```
src/
  app/
    (public)/
      page.tsx                    # home: announcements + recent posts
      posts/[slug]/page.tsx
      categories/[slug]/page.tsx
      tags/[slug]/page.tsx
      search/page.tsx
    admin/
      page.tsx                    # post list dashboard
      posts/[id]/edit/page.tsx
      preview/[id]/page.tsx
      analytics/page.tsx
      moderation/page.tsx         # moderation log
      announcements/page.tsx
      settings/page.tsx           # categories, users
    api/
      auth/[...all]/route.ts      # Better Auth handler
      view/route.ts               # analytics beacon
      comments/route.ts           # comment tree reads (no-store)
      cron/revalidate/route.ts    # cron-job.org target (secret-protected)
  components/                     # server + client components (shadcn/ui)
  db/schema.ts                    # Drizzle schema
  lib/
    auth.ts                       # Better Auth config (Google, Discord, roles)
    markdown.ts                   # unified pipeline
    excerpt.ts                    # derive excerpt from body_md
    moderation.ts                 # AI SDK / gateway client + prompt
    posts.ts                      # visiblePostsWhere() and queries
    ratelimit.ts
  actions/                        # server actions (posts, comments, likes, admin)
```

---

## 7. Environments & Configuration

| Env | Branch | Database | URL | OAuth |
|---|---|---|---|---|
| **Local** | any | Postgres in Docker (match Neon's major version) | `localhost:3000` | Dedicated OAuth client, `localhost` redirect |
| **Staging** | `staging` (long-lived) | Neon `staging` branch (persistent) | Fixed domain (e.g. `staging.paulitakes.com`) assigned to the branch in Vercel | Dedicated OAuth client, staging redirect |
| **Prod** | `main` | Neon `main` | `paulitakes.com` | Dedicated OAuth client, prod redirect |

- The stable staging URL exists specifically so Google/Discord redirect URIs can be registered ahead of time — ephemeral preview URLs can't be. Separate OAuth clients per environment keep a leaked staging secret away from prod.
- No per-PR database branches; PRs merge to `staging` for integration testing, then `staging` → `main`.
- **Env vars:** `DATABASE_URL`, `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL`, per-env Google/Discord creds, `AI_GATEWAY_API_KEY` (local only — deployed envs use Vercel OIDC automatically), `CRON_SECRET`, `ANALYTICS_SALT_SEED`, rate-limit values.
- **Migrations:** drizzle-kit, applied via CI step before deploy (staging first, then prod).
- **Bootstrap:** first admin promoted via a one-time seed script (no in-app path to self-promote).

---

## 8. Security & Privacy Notes

- All mutations are server actions with per-action session + role + ownership checks; middleware is convenience only.
- `rehype-sanitize` on all rendered markdown (posts *and* announcements); comments are plain text with escaped output and auto-linked URLs (`rel="nofollow ugc"`).
- Thumbnail URLs validated as `https://` image URLs; rendered `unoptimized` to avoid the open image-proxy problem with wildcard `remotePatterns`.
- Cron endpoint requires an `Authorization: Bearer ${CRON_SECRET}` header, configured as a custom header on the cron-job.org job (it supports custom headers). Reject anything without it; the route does nothing destructive regardless (it only revalidates caches), so worst case for a leaked URL is extra cache churn.
- Analytics stores only salted daily hashes — no IPs, no cookies, no cross-day correlation.
- Banned users: checked on comment and like actions; sessions not revoked (they can still read).

---

## 9. Build Order (suggested)

1. Scaffold Next + Tailwind/shadcn + Drizzle + local Docker Postgres + Better Auth (Google/Discord, roles); set up staging/prod envs early so OAuth is settled
2. Posts data model + markdown pipeline + public post page & home (static content end-to-end, tag-based caching)
3. Admin: editor, drafts, preview, thumbnail URLs, scheduling (+ cron revalidation)
4. Categories, tags, search
5. Comments (tree UI, gateway moderation, rate limits, moderation log)
6. Likes
7. Announcements
8. Analytics ingest + dashboard
9. SEO polish (metadata, sitemap, OG), mobile pass, launch

Each step ships something usable; the site is launchable after step 4 with comments off.

---

## 10. Resolved (was Open Items in v0.1)

1. **Styling:** Tailwind + shadcn/ui.
2. **Excerpts:** auto-derived from body, no stored field.
3. **Moderation posture:** flagged = rejected outright, logged with verdict for admin monitoring; only LLM failures await review.
4. **Environments:** local Docker Postgres / staging branch + fixed URL / prod. No per-PR branches.
5. **Model access:** Vercel AI Gateway.

## 11. Final Decisions (was Remaining Open Items)

1. **Moderation policy:** family-friendly — flag all profanity, slurs, NSFW, targeted personal attacks on commenters, and spam/scam links; allow heated takes, trash talk, and links from any domain. Full policy in §5.2; few-shot examples to live in the repo and be tuned against real comments post-launch.
2. **Comment reads:** GET route handler (`/api/comments`), `no-store`; writes remain server actions.

**No open items remain — design is locked at v0.3.**
