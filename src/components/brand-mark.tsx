// Paulitakes logo mark, mirroring src/app/icon.svg (BRAND-2/BRAND-4): amber
// flame behind the bowl, white P, solid amber flame counter. Raw hexes are
// the brand-asset exception to the theme-token rule (ADR-0024): the mark
// must render identically in both themes and stay in sync with icon.svg.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#c33f00" />
      <path
        fill="#ffb037"
        d="M31 16C31 11 33.5 10.5 35.8 8.6C36.6 7.4 36.9 5.5 36.8 3.5C38.4 4.6 39.7 6.2 40.5 8.5C41.2 7.9 42.2 7.2 43.5 6.5C44.8 9.3 45.6 12.5 45.8 16Z"
      />
      <path
        fill="#fff8f4"
        d="M20 12h13c7.18 0 13 5.82 13 13s-5.82 13-13 13h-3v14H20V12Z"
      />
      <path
        fill="#ffb037"
        d="M30 20V30H33C35.76 30 38 27.76 38 25C38 23.1 37.1 21.6 35.4 20.7C35.7 21.9 35.4 22.8 34.5 23.4C34.4 21.9 33.6 20.8 32.1 20Z"
      />
    </svg>
  );
}
