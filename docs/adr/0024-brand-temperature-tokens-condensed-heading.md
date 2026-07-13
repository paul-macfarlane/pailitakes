# 0024. Brand identity: hot/cold temperature tokens + condensed athletic heading font

- **Status:** Accepted
- **Date:** 2026-07-12
- **Related:** BRAND-1 (backlog/10-brand.md), FR-9.4, engineering rules "Theme tokens only"; supersedes the "neutral base color" note in [0006](0006-shadcn-base-ui.md)

## Context

The app shipped with zero visual identity: stock shadcn neutral (chroma-0) palette, default Geist everywhere, scaffold favicon, text-only wordmark. Paul asked for a real brand that matches the spirit of the app. The only brand material that existed was the name and the tagline "Hot takes, cold analysis" — which itself suggests a direction. Constraints: light/dark/system toggle means every choice must hold in both modes; long-form reading pages need quiet surfaces; the AI-design cliché of "near-black + single vermilion accent" (dark-only, untinted neutrals) was explicitly avoided as a default.

## Decision

Encode the tagline as a **temperature system** in the theme tokens (`src/app/globals.css`):

- All neutrals carry a **cold slate tint** (hue ~250–255, low chroma) in both modes — surfaces are the "cold analysis."
- One **hot ember accent** — `oklch(0.55 0.185 45)` light, `oklch(0.68 0.17 45)` dark — is reserved for actions, focus, hover, and identity (`--primary`, `--ring`, `--accent`, `--chart-1`, sidebar equivalents). Hue 45 keeps it distinct from destructive red (~27) and warning amber (~58). `--destructive`/`--warning`/`--radius` stay stock.
- Headings sitewide use **Barlow Condensed** (500–800, loaded via `next/font`) through the existing `--font-heading` token plus a base-layer `h1–h6` rule; wordmarks render uppercase condensed. Geist stays the body face.

All fg/bg pairs were numerically validated ≥ 4.5:1 WCAG AA in both modes before adoption.

## Consequences

The brand lives entirely in tokens, so components need no per-surface color work and future reskins are a one-file change; prose (markdown) headings inherit the display face for free. Barlow Condensed adds one font download (4 static weights — new weights used in components must be added to the `layout.tsx` loader). Any new token value must preserve the AA-validated pairs and the hue-separation between ember, destructive, and warning. BRAND-2 (icons/logo/manifest) and BRAND-3 (branded OG card) build on these tokens. Revisit if a real logo mark demands a different accent hue.
