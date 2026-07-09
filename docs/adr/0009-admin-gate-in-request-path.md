# 0009. Admin gate: cookie-presence proxy + requireStaff() in layout and every page

- **Status:** Accepted
- **Date:** 2026-07-06
- **Related:** technical-design.md §3 (route table), §5.7, §9; backlog ADM-1; FR-7.x

## Context

The design (§3/§5.7, locked) says "middleware redirects non-author/admin from `/admin/**`" while also stating middleware is UX only and server-side checks are the security boundary. Two facts make a literal middleware _role_ gate the wrong implementation:

1. The role lives in Postgres, not in the session cookie. Reading it in the proxy means a DB lookup on every matched request, duplicating the authoritative check for no security gain (Better Auth's recommended pattern is optimistic cookie-presence middleware + real checks server-side).
2. Next.js renders layouts and pages **in parallel**, so an auth check in `admin/layout.tsx` cannot prevent a page segment from rendering and streaming its content. A layout-only gate would leak page data to requests holding an invalid cookie; verified empirically during ADM-1 (the placeholder page's content appeared in the response stream before the fix).

## Decision

- **Proxy (`src/proxy.ts`):** checks session-cookie _presence_ only for `/admin/:path*`, redirecting cookieless requests to `/sign-in?next=<path>` — pure UX, keeps bots and signed-out users from hitting the app server.
- **`requireStaff()` (`src/lib/session.ts`):** the canonical gate — session present, `isStaff()` (role `author`/`admin` via `src/lib/authz.ts`, not banned), else redirect. Called by the admin layout (for chrome) **and by every `/admin` page** (and later by every admin server action per §9). Calling it also forces each admin page dynamic, satisfying §3 "fully dynamic". `getSession()` is React-`cache()`d, so layout + page double-calls cost one DB lookup.

## Consequences

- Easier: one shared predicate (`isStaff`) reused by ADM-3 action checks; no per-request proxy DB hit; admin pages can't accidentally be prerendered if they call `requireStaff()`.
- Harder: the gate is a per-page convention, not structurally enforced — every new `/admin` page must call `requireStaff()` first. Review checklist item until a lint rule or wrapper makes it structural.
- Signed-in readers pass the proxy and are turned away by `requireStaff()` (redirect to `/`) — acceptable: they see nothing, and the design's middleware wording is updated to match this implementation.
