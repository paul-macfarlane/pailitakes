# 0015. Explicit post creation and flush-before-lifecycle in the editor

- **Status:** Accepted
- **Date:** 2026-07-11
- **Related:** ADR-0011 (staged edits — amends its "Resolve = full reload" note), ADR-0012; technical-design.md §5.7; user bug reports on the admin-authoring epic

## Context

Manual testing surfaced three connected editor bugs, all traceable to unrecorded decisions in the original autosave implementation (ADM-2's "autosave drafts on interval"):

1. **Auto-create.** The 5-second autosave tick called `createPost` as soon as the title was non-empty — typing on `/admin/posts/new` silently created a database row the author never asked for.
2. **Router desync.** After that auto-create, the editor swapped the URL with raw `window.history.replaceState` (an inline-commented hack to avoid interrupting typing with a navigation). Next's App Router never learned about it: navigating to "New post" later reused the still-mounted form instance — old field values, and a `postIdRef` still pointing at the previous post, so "new" typing silently updated the old row.
3. **Client-side data loss.** ADR-0011's "Resolve = full reload" after Publish/Discard changes is correct for avoiding stale editor state, but nothing flushed the form first — the publish/status/schedule controls are sibling client islands with no access to the editor's state, so up to one autosave interval of typing was wiped deterministically. Worse, `form.trigger()` failing (any invalid field) made every autosave tick return silently: nothing saved, no warning, and the reload then wiped _everything_. ADR-0011's "no silent lost updates" CAS guarantee held at the database; the losses were all client-side and undocumented.

## Decision

- **Creation is explicit.** `save()` takes an `explicit` flag; only the "Save now" button and form submit pass it. The interval tick never creates — it only autosaves an already-created post. An explicit save with an empty title shows "Add a title before saving" instead of silently returning.
- **Proper navigation after create.** `router.replace("/admin/posts/{id}/edit")` replaces the `history.replaceState` hack. This is acceptable now precisely _because_ creation is explicit: a remount after a deliberate click doesn't interrupt passive typing, which was the hack's whole justification. A defensive `key={initialPost?.id ?? "new"}` on the editor makes stale-instance reuse impossible even on same-segment prop changes.
- **Lifecycle actions flush first.** `save()` returns success; `PostEditorSection` exposes it through `EditorFlushContext` to the pending/status/schedule islands, which flush before their server action and abort with a visible error if the flush fails. Exception: **Discard proceeds even if the flush fails** — the user is throwing edits away, so refusing to discard because we couldn't save what's being discarded would be absurd. ADR-0011's full reload on resolve stays; it is now safe because the flush ran first.
- **No more silent skips.** A validation-blocked autosave tick sets a visible error status ("Fix the highlighted field — changes aren't being saved."), and a `beforeunload` guard warns when unsaved changes exist (reading live state at event time so the post-flush reload isn't blocked).

## Consequences

- Easier: an untouched `/new` page leaves no orphan rows; "New post" always means a fresh form; publishing always includes what the author just typed (or refuses loudly); the failure modes that were silent are now visible. Three e2e regression tests pin each original bug.
- Harder: the flush context couples the lifecycle islands to the editor's presence on the page (they degrade to acting without a flush when no provider exists); creation now requires a deliberate click, so an author who types and navigates away without saving loses that never-saved draft — the `beforeunload` prompt is the only net for that, which is the standard editor trade.
- The hard-delete UI shipped alongside (admin-only `AlertDialog` confirm, `router.push` to the dashboard after — the edit route 404s once the row is gone) implements the ADM-3 backend as designed and needed no new decisions beyond this repo's first confirmation-dialog primitive.
