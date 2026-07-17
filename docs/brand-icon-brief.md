# Paulitakes — logo & app-asset generation brief

Self-contained brief for generating a logo/icon proposal for Paulitakes with an
image model (written for Gemini / Nano Banana, but model-agnostic). Everything
a designer or model needs is in this one document.

## About the app

Paulitakes is a mobile-first sports blog. Paul — and the occasional guest
author — publishes "takes": opinion pieces, analysis, and reactions, almost
entirely sports-related. The tagline is **"Hot takes, cold analysis."** and the
whole visual identity is built on that temperature contrast: cool slate
neutrals for the reading surface, one hot ember accent for identity and
action. Readers browse and search for free and can sign in with Google or
Discord to comment and like.

The logo must pass **Google's OAuth consent-screen branding review**, which
rejected a previous plain "P" monogram for not uniquely identifying the brand.
So: distinctive and ownable, and it must not resemble any existing brand
(especially not Google's or any sports league's marks).

## Brand system

- **Ember orange** `#c33f00` — primary brand color, tile/background of the mark
- **Lighter ember** `#ea6f2f` — secondary hot tone
- **Flame amber** `#ffb037` — highlight used for flame details in the current mark
- **Off-white** `#fff8f4` — glyph color on ember
- **Near-black** `#070b11` and **slate** `#96a0ab` — the "cold" side, used on the share card
- **Typography:** headings are Barlow Condensed (bold, uppercase, tight); any
  lettering in assets should match that condensed, athletic feel.

Current mark (for comparison): a rounded-square ember tile with a white
condensed "P" whose bowl has an amber twin-tongue flame rising behind it and a
solid amber flame filling the bowl's counter.

## Icon design brief

Generate a square app icon:

- A **rounded-square tile** filled with ember orange `#c33f00` (corner radius
  ≈ 22% of the edge, like a 14/64 radius), edge-to-edge — no outer margin,
  no drop shadow, no 3D bevel.
- On the tile, a **flat vector-style monogram or pictogram** combining the
  letter **P** with a **flame** motif ("hot takes"). Use only the palette
  above: off-white glyph, amber `#ffb037` (and optionally `#ea6f2f`) for
  flame detail. Maximum 3 colors on the tile.
- **Flat shapes only** — no gradients, no texture, no photorealism, no
  outlines/strokes, no text other than the single letterform.
- **Must stay legible when shrunk to 16×16 pixels**: the P silhouette must
  survive; flame detail may disappear at that size but must not muddy it.
- Must be original: no resemblance to existing logos (Tinder's flame, Hot
  Wheels, team/league marks, Google products, etc.).

Produce the master at **1024×1024** on a transparent background outside the
tile's rounded corners.

## Assets the app needs (derive all from the master)

Downscale from the 1024 master with sharp edges (no added padding unless
noted). Exact files the app uses:

| Asset                    | Size(s)                                          | Notes                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `favicon.ico`            | 16, 32, 48 px (multi-frame ICO)                  | Browser tab; the 16 px frame is the legibility gate                                                                                                                                                                                                                                                                                            |
| `icon.svg` / master icon | 1024 px master (app's source of truth is vector) | Transparent corners                                                                                                                                                                                                                                                                                                                            |
| `apple-icon.png`         | 180×180                                          | iOS home screen; keep the tile full-bleed, iOS rounds it                                                                                                                                                                                                                                                                                       |
| `icon-192.png`           | 192×192                                          | PWA manifest                                                                                                                                                                                                                                                                                                                                   |
| `icon-512.png`           | 512×512                                          | PWA manifest; also uploaded as the Google OAuth consent-screen logo (Google wants ≥120×120, <1 MB, PNG/JPG)                                                                                                                                                                                                                                    |
| Open Graph share card    | 1200×630                                         | Separate composition, not a resize: near-black `#070b11` background; the icon tile at ~96 px in the top-left; "PAULITAKES" huge in white condensed uppercase (Barlow Condensed style); tagline below with "Hot takes," in `#ea6f2f` and "cold analysis." in `#96a0ab`; a thin ember gradient bar (`#c33f00` → `#ea6f2f`) along the bottom edge |

## Acceptance checklist

1. Recognizably a "P" AND recognizably a flame at 48 px and up.
2. Still a clean, readable mark at 16 px.
3. Only brand-palette colors; flat vector look; no gradients or shadows on the icon.
4. Looks correct on both light (`#f1f3f4`) and dark (`#202124`) browser chrome.
5. Unique — passes "does this look like any brand I know?" with a no.
