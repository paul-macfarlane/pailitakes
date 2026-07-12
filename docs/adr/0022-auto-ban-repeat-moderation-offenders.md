# 0022. Auto-ban repeat moderation offenders inline, on a live rejected-count

- **Status:** Accepted
- **Date:** 2026-07-12
- **Related:** FR-4.9 (new), FR-4.8, technical-design.md §5.2, CMT-10. Numbered 0022 because 0021 is taken by the likes ADR on the concurrent `feat/like` branch.

## Context

Paul asked for automatic banning of users who repeatedly post content the moderator rejects. The design space: where the check runs (inline at rejection time vs. a cron sweep), what it counts (a stored strike tally vs. a live query), and how false positives interact with it (the moderation policy warns the LLM can over-flag, and CMT-9 built a restore action precisely for that).

## Decision

Check inline at the two places a comment lands `rejected` (create, flagged-edit demotion) — no cron, no new infra. Count live: `status = 'rejected' AND (created_at OR edited_at) > window start` (the OR catches demoted edits whose `created_at` is stale). Defaults 5 in 7 days, both env vars beside the rate-limit config. At/above threshold, ban through the existing `setUserBannedService` — reusing its row-locking, last-active-admin invariant, and already-banned no-op rather than writing `banned_at` from the comments domain. The step is fire-and-forget: refusals (last admin) and errors are logged and swallowed; the commenter's rejection result is never altered. No `ban_source` column — the moderation log shows the author's ban state (existing "Banned" pill convention) and the `console.info` event is the audit trail; auto-ban applies to all roles, same as manual ban.

## Consequences

A live count means restores un-count false positives with zero bookkeeping — no tally to reconcile, no decrement bugs — at the cost of one indexed count query per rejection (rare events). Held comments never count, so the fail-closed local/no-key path can't ban anyone. Auto and manual bans are indistinguishable in data; if "who/what banned this user" ever matters, that's a new column and a superseding ADR. A banned author or admin loses staff access too (bannedAt overrides role) — accepted for uniformity with manual bans; exempting staff would be a one-line predicate in the auto-ban service. Thresholds are startup-validated env, so tuning requires a deploy.
