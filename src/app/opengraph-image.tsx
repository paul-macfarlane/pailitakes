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
          d="M20 12H33C35 12 36.3 10.2 36.6 8C36.9 6.5 36.9 5 36.8 3.5C38.4 4.6 39.7 6.2 40.5 8.5C41.2 7.9 42.2 7.2 43.5 6.5C45 9.5 46 16 46 25C46 32.18 40.18 38 33 38H30V52H20ZM30 20V30H33C35.76 30 38 27.76 38 25C38 23.1 37.1 21.6 35.4 20.7C35.7 21.9 35.4 22.8 34.5 23.4C34.4 21.9 33.6 20.8 32.1 20H30Z"
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
