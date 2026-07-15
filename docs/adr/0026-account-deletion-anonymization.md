# 0026. Account deletion and comment anonymization semantics

- **Status:** Accepted
- **Date:** 2026-07-14
- **Related:** FR-10.4, technical-design.md §4 (comments), §5.9, §8, ACCT-1, ADR-0020

## Context

ACCT-1 adds self-service account deletion. The `comments.author_id` and `posts.author_id` FKs deliberately RESTRICT on user delete (fail loudly), so the user's comments must be detached first — but threads must survive (ADR-0020's placeholder rule). Open choices: how to anonymize (per-comment soft/hard-delete like ADR-0020's own-comment delete, vs. one uniform update), how to detach authorship (nullable FK vs. a sentinel "deleted user" row), what to do with staff accounts that authored posts (refuse vs. transfer), and whether to route deletion through Better Auth or a bespoke server action.

## Decision

- Deletion goes through Better Auth's `user.deleteUser` (client `authClient.deleteUser()` from a confirm dialog); a `beforeDelete` hook runs the guards and anonymization, and a thrown `APIError` blocks the deletion with a user-facing message.
- Anonymization is **one uniform UPDATE** over all the user's comments: `author_id = NULL`, `status = 'deleted'`, `body = ''`, `mod_verdict = NULL`. No childless-hard-delete loop: the ADR-0020 prune rule already hides placeholder rows without visible descendants, so the display is identical and the retained rows hold no PII.
- `comments.author_id` becomes **nullable** (NULL = author deleted their account); the FK keeps RESTRICT so any non-anonymized row still blocks a user delete loudly. The comment-tree read becomes a `leftJoin`; null-author rows are redacted like non-visible ones. `posts.author_id` is unchanged.
- **Refusals:** staff with authored posts (transfer-first is deferred), and the last active admin (`wouldOrphanAdmins` under `withLockedUserMutation`). Banned users may delete their own account. (Amended by 0027: never-public comment-free posts are now auto-deleted; transfer exists.)
- Likes disappear via the existing `ON DELETE CASCADE` on the like tables; Better Auth's own cascade covers sessions/accounts.
- OAuth-only users have no password, so Better Auth's fresh-session check (24h `freshAge` default) applies; the UI maps `SESSION_EXPIRED` to "sign out and back in" copy.

## Consequences

- Easier: deletion is atomic where it matters (guards + anonymize share one locked transaction) and thread integrity needs no recursive delete logic.
- Accepted race: the admin-set lock releases when `beforeDelete` returns, before Better Auth deletes the row — two admins self-deleting simultaneously could in theory orphan the site. Negligible at this site's scale; revisit if admin count grows.
- Accepted partial state: if the row delete fails after the hook ran, comments are already anonymized while the account survives; a retry completes it (anonymization is idempotent).
- Sessions older than 24h can't delete without re-signing-in — a deliberate security posture inherited from Better Auth defaults.
- If staff post transfer is ever needed, it's a new flow on top of the same guards (refusal message already points at the site owner).
