# Epic: Brand & Visual Identity (BRAND)

Real brand for Paulitakes: theme, icons, wordmark, branded share card. Docs are silent on visual identity beyond the name (product-doc.md §4.1) and thumbnail-as-OG (FR-1.4); direction gets recorded via ADR when BRAND-1 lands. Ref: technical-design.md §5.8 ("optionally a branded `next/og` card later").

- [x] **BRAND-1** — Brand direction + theme tokens: pick brand hue(s) and a distinct heading font; replace the stock-neutral shadcn palette (`--primary`/`--accent` etc.) in light AND dark, wire the existing `--font-heading` token to a real display font. Mobile-first, theme-token rules apply. Record direction via ADR (supersedes ADR-0006's "neutral base color" note). _(deps: none; requested 2026-07-12 by Paul)_
- [x] **BRAND-2** — Identity assets: SVG logo mark + wordmark in the site header, `src/app/icon.svg`, `apple-icon`, replace scaffold `favicon.ico`, add `manifest.ts` + `themeColor` metadata. _(deps: BRAND-1)_
- [x] **BRAND-3** — Branded `next/og` share card as the site-wide/fallback OG image (post thumbnails still win per FR-1.4); shrinks SEO-1 to per-post wiring. _(deps: BRAND-1)_
