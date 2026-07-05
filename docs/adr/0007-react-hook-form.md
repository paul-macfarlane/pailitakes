# 0007. react-hook-form for form state

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** ADR-0006 (Base UI), FR-10.2 (editable display name); `.claude/rules/engineering.md` (validate external input with zod)

## Context

Forms so far were hand-rolled `useState`. The app will accumulate more (post editor, announcements, categories, comment box), and per Paul's feedback a form library should standardize validation, error display, and submit state. Candidates: react-hook-form and TanStack Form.

## Decision

**react-hook-form** with `@hookform/resolvers/standard-schema` (zod v4 implements Standard Schema; the dedicated zod resolver's types lag zod releases), so the same zod schemas serve client forms and server boundaries. Markup uses shadcn's library-agnostic `Field` components (`field.tsx`) — the classic RHF-coupled `form.tsx` component doesn't exist for Base UI styles. `DisplayNameForm` is the reference implementation.

TanStack Form is the stronger pure-TS design, but shadcn/ui's ecosystem, docs, and examples center on RHF; with our small, conventional forms, design-system alignment beats API elegance.

## Consequences

- One pattern for every form: zod schema → `useForm({ resolver })` → `Field` markup → `formState` for submit/pending/errors.
- Client and server validate with the same zod schemas (shared from `src/lib`).
- Revisit only if shadcn ships first-class TanStack Form support and a migration is otherwise motivated.
