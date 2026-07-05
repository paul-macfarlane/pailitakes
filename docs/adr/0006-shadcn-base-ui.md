# 0006. shadcn/ui on Base UI primitives (base-nova style)

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** technical-design.md §1 (Tailwind + shadcn/ui); backlog FND-2, FND-11

## Context
`shadcn init` (CLI v4, 2026) defaults new projects to Base UI primitives with the `base-nova` style rather than Radix. Components look and behave the same; the composition API differs. Overriding back to Radix is possible but buys nothing for this project (no AI Elements dependency, which is the main Radix-only consumer).

## Decision
Keep the CLI default: Base UI primitives, `base-nova` style, neutral base color (`components.json`). Conventions for all UI work (each learned the hard way — Radix habits fail at runtime, not compile time):

- `render` prop instead of Radix's `asChild` (e.g. `<DropdownMenuItem render={<Link .../>}>`).
- A Base UI "button" rendering a non-button element gets `role="button"`, so links styled as buttons use `buttonVariants` on a real `<Link>` instead of wrapping.
- `DropdownMenuLabel` wraps Base UI's `GroupLabel` and **throws unless inside `DropdownMenuGroup`** ("MenuGroupContext is missing").
- Menu items fire `onClick`, not Radix's `onSelect` — `onSelect` type-checks (it's a DOM prop) but never fires.

## Consequences
- Stock shadcn docs/snippets that use `asChild` need mechanical translation to `render`; the FND-11 components are the in-repo reference.
- Future components must be added with the same CLI (it pulls Base UI variants automatically); mixing Radix-flavored component source into `components/ui` would fork the convention.
- Revisit only if a needed dependency is Radix-only (e.g. AI Elements).
