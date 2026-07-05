# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** todos.md (harness setup)

## Context

This is a solo project intended to eventually be worked by autonomous agents. Architectural context that lives only in someone's head, a chat log, or a commit message is lost to future contributors (human or agent). Decisions need a durable, discoverable home in the repo.

## Decision

We keep Architecture Decision Records in `docs/adr/`, one file per decision, numbered sequentially, using `template.md`. Records are immutable once accepted; a changed decision is a new ADR that supersedes the old one. The `/adr` command scaffolds new records. The broad, already-settled decisions live in `docs/technical-design.md`; ADRs capture decisions made _during_ implementation and any deviations from that doc.

## Consequences

- Anyone (or any agent) can reconstruct _why_ the code is shaped as it is.
- Small ongoing cost: a decision worth recording must actually be recorded at the time it's made.
- Two sources of "why" — the technical design doc (baseline) and ADRs (deltas). The index in `README.md` and cross-links keep them reconciled.
