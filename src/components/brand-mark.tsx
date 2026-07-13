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
        d="M20 12h13c7.18 0 13 5.82 13 13s-5.82 13-13 13h-3v14H20V12Zm10 8v10h3a5 5 0 0 0 0-10h-3Z"
      />
    </svg>
  );
}
