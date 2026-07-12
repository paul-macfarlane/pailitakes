# Epic: Accounts (ACCT)

Self-service account management. Ref: FR-10.x; requested 2026-07-12 by Paul (CMT review feedback).

- [ ] **ACCT-1** — Delete own account: confirmation flow via Better Auth; on deletion, anonymize the user's comments (thread-preserving — placeholders/threads must survive) and remove their likes. Note `comments.author_id` and `posts.author_id` FKs deliberately fail loudly on user deletion today, so anonymization must happen first, and staff accounts with authored posts need explicit handling (refuse or transfer). Anonymization semantics → ADR. _(deps: CMT-1)_
