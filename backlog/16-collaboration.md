# Human collaboration

Approved by Paul September 20, 2026: [decision record](https://app.notion.com/p/3dac4dbb6217802696aac7aa05c60fb8). See FR-7.14–7.16 and ADR-0037.

- [x] **COLLAB-1** — Safe concurrent saves, delivered by AIR-2; reuse the existing editVersion foundation. _(deps: AIR-2)_
- [x] **COLLAB-2** — Owner/admin-managed post-scoped Reviewer and Editor access for existing authors, private preview/review reads, safe Editor saves, and Shared with me discovery (FR-7.14). _(deps: AIR-6)_
- [x] **COLLAB-3** — First usable human review milestone: request/start/submit statuses, human-attributed suggestions with explanations and correction shortcut, general and per-suggestion comments including feedback-only reviews, multiple human reviews, owner/admin selective decisions, guided stale-review refresh (FR-7.15–7.16). _(deps: COLLAB-2)_
- [x] **COLLAB-4** — Threaded discussion and resolution on immutable review/change anchors (FR-7.16). _(deps: COLLAB-3)_

Automatic carry-forward and email notifications are deferred. Basic comments are part of COLLAB-3, not deferred with richer discussion.
