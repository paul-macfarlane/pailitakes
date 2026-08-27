# Epic: Revisions & Editing (REV)

Revision history for posts — every saved draft and every publish becomes a durable, browsable revision — plus diffs between any two revisions and between the editor's unsaved buffer and any revision. Builds on the staged-draft model (ADR-0011/0012: a `post_drafts` row is the one pending snapshot on a public post) rather than replacing it. Ref: FR-7.x; technical-design.md §4, §5.7.

Purpose (see `docs/vision.md`): make revising a stale draft cheap — see exactly what changed since the last publish, restore a version that was better, and stop losing text to an autosave you didn't mean. Anything beyond that (branching, collaborative editing, comments-on-diffs) is out of scope.

## Decisions (Paul, 2026-08-27) — REV-1 records these in an ADR + design doc

1. **Revision triggers:** automatic on publish/promote; explicit "Save revision" button in the editor; autosave cuts a revision too, but time-debounced (at most one per ~10 min of continuous autosaves). Autosave still writes the live `post_drafts` buffer on every tick as today.
2. **One table:** `post_revisions` with `kind` = `draft` | `published`. A `published` revision is the snapshot at publish/promote time; the draft chain leading up to it is retained as `draft` rows.
3. **Snapshot = full shape** mirroring `post_drafts` (title, slug, body_md, thumbnail_url, banner_url, video_url, category_id, tags-as-names).
4. **Restore** writes the chosen revision into the staged-draft buffer and cuts a new `draft` revision. It never touches the live post; publish stays the only path to public. History is append-only.
5. **Retention:** unbounded. Revisions cascade-delete with the post.
6. **Diff:** word-level inline diff of the markdown source, GitHub-style add/remove marks, pure client-side (small `diff`-style lib). No side-by-side, no rendered-HTML diff.
7. **Default comparison base** for the unsaved-vs-revision diff: the last `published` revision (falls back to the last `draft` revision on never-published posts), with a picker to choose any other.
8. **UI:** History panel on `/admin/posts/[id]` (list, compare any two, restore) + "What changed since publish" button in the editor; dashboard post list shows an "N unpublished revisions" badge.
9. **Transfer (ADR-0027)** keeps full history — revisions belong to the post, not the author. Author-scoped visibility follows the usual ownership check; `ManageAnyPost` bypasses.

## Tasks

- [ ] **REV-1** — ADR recording the decisions above; add `post_revisions` to technical-design.md §4 and the revision/diff/restore flows to §5.7. _(deps: none)_
- [ ] **REV-2** — Schema + data layer: `post_revisions` table (post FK cascade, `kind`, snapshot columns mirroring `post_drafts`, `created_by`, `created_at`); `data.ts` insert/list/get; revision cut inside the existing publish/promote transactions, on explicit save, and on the debounced autosave trigger. _(deps: REV-1)_
- [ ] **REV-3** — Pure diff lib in `src/lib/posts/diff.ts`: snapshot → snapshot field-by-field diff, word-level for `body_md`, unit-tested on markdown edge cases (code fences, lists, unchanged/empty/whitespace-only). _(deps: REV-1)_
- [ ] **REV-4** — History UI on the post edit page: revision list, compare any two, restore-to-buffer with confirmation; ownership + capability checks on every action. _(deps: REV-2, REV-3)_
- [ ] **REV-5** — Unsaved-vs-revision diff in the editor: client island diffs the live editor state against a chosen revision (default: last published revision, picker for others) without saving. _(deps: REV-4)_
- [ ] **REV-6** — Dashboard list badge ("N unpublished revisions" since last published revision), and tests proving history survives transfer (ADR-0027) and cascades on delete. _(deps: REV-2, ADM-8)_
