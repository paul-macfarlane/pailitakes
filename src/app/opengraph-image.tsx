import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Site-wide branded share card (BRAND-3; technical-design §5.8's "branded
// next/og card"). Routes that declare their own og:image (SEO-1 wires post
// thumbnails per FR-1.4) override this — it's the fallback identity card.
// Colors are the rendered ADR-0024 brand values: theme tokens are CSS-only
// and unavailable inside ImageResponse.

export const alt = "Paulitakes — Hot takes, cold analysis.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  // fs (not fetch(import.meta.url)): Turbopack doesn't rewrite the fetch-asset
  // pattern. The route is static/cacheable and Next's file tracing picks these
  // literal paths into the serverless bundle (verified in route.js.nft.json).
  const [barlow600, barlow700] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/barlow-condensed-600.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/barlow-condensed-700.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#070b11",
        padding: "72px 80px 96px",
        fontFamily: "Barlow Condensed",
      }}
    >
      {/* mark tile — same shapes as src/app/icon.svg */}
      <svg width="96" height="96" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill="#c33f00" />
        <path
          fill="#fff8f4"
          fillRule="evenodd"
          d="M20 12h13c2 0 3.5-1.7 4-3.6.3-1.4.5-2.9.4-4.4 5 4 8.6 10.4 8.6 21 0 7.18-5.82 13-13 13h-3v14H20V12Zm10 8v10h3c2.76 0 5-2.24 5-5 0-1.9-.9-3.4-2.6-4.3.3 1.2 0 2.1-.9 2.7-.1-1.5-.9-2.6-2.4-3.4H30Z"
        />
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 176,
            fontWeight: 700,
            color: "#eff2f5",
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
            lineHeight: 0.9,
          }}
        >
          Paulitakes
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 600,
            marginTop: 28,
          }}
        >
          <span style={{ color: "#ea6f2f" }}>Hot takes,</span>
          <span style={{ color: "#96a0ab", marginLeft: 14 }}>
            cold analysis.
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: 16,
          background: "linear-gradient(90deg, #c33f00, #ea6f2f)",
        }}
      />
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Barlow Condensed",
          data: barlow600,
          weight: 600,
          style: "normal",
        },
        {
          name: "Barlow Condensed",
          data: barlow700,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
