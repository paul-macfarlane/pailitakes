// Paulitakes logo mark, mirroring src/app/icon.svg (BRAND-2). Raw hexes are
// the brand-asset exception to the theme-token rule (ADR-0024): the mark
// must render identically in both themes and stay in sync with icon.svg.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#c33f00" />
      <path
        fill="#fff8f4"
        fillRule="evenodd"
        d="M20 12h13c2 0 3.5-1.7 4-3.6.3-1.4.5-2.9.4-4.4 5 4 8.6 10.4 8.6 21 0 7.18-5.82 13-13 13h-3v14H20V12Zm10 8v10h3c2.76 0 5-2.24 5-5 0-1.9-.9-3.4-2.6-4.3.3 1.2 0 2.1-.9 2.7-.1-1.5-.9-2.6-2.4-3.4H30Z"
      />
    </svg>
  );
}
