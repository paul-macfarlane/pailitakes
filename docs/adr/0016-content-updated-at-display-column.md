# 0016. Dedicated `content_updated_at` column drives the public "Updated" date

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** FR-9.2 (post page shows date — silent on edits), FR-1.6 (archive restore preserves feed position), ADR-0011/0012 (staged edits); technical-design.md §data model (amended); backlog POST-10

## Context

The public site showed only `publish_at`; a post edited and re-published after going live gave readers no signal that the content changed. FR-9.2 says the post page shows "date," singular — an updated-date display was unspecified, and the owner decided it should exist (post detail page only; feed cards stay publish-date-only for chronological honesty).

The obvious source, `posts.updated_at`, is disqualified by its own semantics: it is a Drizzle `$onUpdate` hook that bumps on **every** `db.update(posts)` — status transitions, tags-only edits, scheduling — so driving the display from it would show "Updated" for changes readers never saw. There is also a lifecycle trap: `publish → draft → publish` deliberately re-stamps `publish_at = now` (lifecycle.ts), so any older "updated" timestamp can legitimately predate the displayed publish date.

Options considered: (a) render `updated_at` with a threshold heuristic — rejected as noisy and dishonest; (b) suppress the `updated_at` bump on non-content writes — rejected, it would change admin-dashboard sort semantics; (c) a dedicated column stamped only where readers actually see new content.

## Decision

- New nullable `posts.content_updated_at` (timestamptz, no default, **no `$onUpdate`**).
- **Exactly one writer:** `promoteStagedDraft` — the ADR-0011 "Publish changes" promote — stamps it `now()` inside the promote transaction. Editing a not-yet-visible post, status transitions, scheduling, and tag edits never touch it. The stamp's meaning is precisely "the moment readers saw changed content."
- **Display guard is comparative, not presence-based:** the post page renders `Updated {date}` only when `content_updated_at > publish_at` (pure helper `showsUpdatedDate`, unit-tested). This makes republish-after-draft safe automatically — the fresh `publish_at = now` exceeds any stale content stamp — while `archived → published` (which restores the original `publish_at` per FR-1.6) correctly keeps showing a pre-archive update. No reset logic needed anywhere in the lifecycle machine.
- Detail page and admin preview render it (shared `PostArticle`, pixel-identical per ADM-7); feed/home cards do not.

## Consequences

- Easier: honest reader-facing edit signal with zero coupling to lifecycle code — the guard absorbs every status-machine path, so future transitions can't silently break the display. No cache changes: promote already revalidates `post:{slug}`.
- Harder: two timestamp columns with adjacent names (`updated_at` vs `content_updated_at`) invite misuse — the schema comments state which is which; `updated_at` remains admin-dashboard-only. Same-day edits render an "Updated" date identical to the publish date (accepted; granularity is date-only by design).
- Deviation from the locked design doc's data model (v0.3) — approved by the owner 2026-07-11; data-model section amended alongside this ADR.
- Revisit if: an edit-history requirement arrives (this column keeps only the latest stamp), or authors want a "minor edit, don't bump" flag.
