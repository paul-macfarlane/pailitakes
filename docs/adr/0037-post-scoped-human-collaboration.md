# ADR-0037: Post-scoped human collaboration

- Status: Accepted
- Date: 2026-09-20
- Related: FR-7.14–7.16; technical-design §5.7 (amended); COLLAB-2–4; ADR-0030/0036

## Context

Paul and Bailey need to review each other's drafts safely. Paul approved Reviewer/Editor roles, owner/admin decisions, shared human/AI review presentation, and the workflow captured in the Notion collaboration task.

## Decision

Use per-post memberships for existing active authors, defaulting to Reviewer. Editor adds direct safe-save editing. Keep publication, proposal decisions and collaborator management owner/admin-only. Reuse immutable proposals and source versions for human suggestions, including a reviewer-selected mechanical-correction explanation shortcut. Include basic comments and feedback-only submissions in the first usable human review milestone; richer discussion follows.

Serialize grants, role changes and revocations on the parent post lock. When a change removes an Editor's write access (Editor → Reviewer or removal), rotate editVersion in the same transaction so the existing safe-save CAS rejects any in-flight save authorized before the change. Grants and Reviewer-only changes do not rotate: reviewers never write, and rotating would needlessly stale open editor tabs and reviews. Reads check staff capability first, then explicit membership, so a membership row grants nothing after demotion or ban. Lists reveal only assigned posts; retained review attribution survives access revocation. Membership rows persist through staff demotion or ban and grant nothing meanwhile; re-promotion or unban restores them, so owners revoke explicitly when access should end for good. Demotion/ban does not rotate editVersion (matching the existing owner behavior); only membership revocation does. Admins are not offered as collaborators because they already manage every post.

Collaborator management lives on a separate owner/admin Sharing page reached through the editor's flush-before-navigate path, so a revocation never races the owner's own unsaved edits. A Reviewer who opens the editor URL is redirected to the private preview.

## Consequences

This deliberately extends the old owner/admin-only private-read/edit rule with the user-approved membership exception. Revoking an Editor stales existing editor tabs and open reviews even without content changes; this conservative tradeoff reuses the proven concurrency contract and is limited to the one case that needs it. COLLAB-2 ships access/discovery first; human submission, statuses, basic comments and guided refresh remain COLLAB-3. No email notifications, real-time coediting, automatic merge or extra mutable article branch.
