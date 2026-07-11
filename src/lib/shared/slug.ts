// No "server-only" here (unlike most of src/lib): ADM-2's editor form needs
// slugifyTitle for client-side validation before the server actions
// re-validate on the server, which is the actual security boundary. Lives
// under src/lib/shared because slug derivation is shared by the posts and
// categories domains (SRCH-1), not owned by either.

// Shared by slugifyTitle (titles) and tagToSlug (tag names): lowercase,
// strip diacritics, collapse non-alphanumeric runs to hyphens, cap length.
// Returns "" when the input has no slugifiable characters at all (e.g.
// emoji-only, CJK, Cyrillic) — callers decide how to handle that.
export function slugifyCore(text: string): string {
  const withoutDiacritics = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  const collapsed = withoutDiacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return collapsed.slice(0, 80).replace(/-+$/, "");
}

// Post titles/slugs can carry accents, emoji, punctuation — anything an
// author types. Normalize to a clean, URL-safe, lowercase slug.
export function slugifyTitle(title: string): string {
  // All-emoji (or otherwise unslugifiable) titles collapse to "" — fall back
  // to a stable placeholder rather than an empty slug column.
  return slugifyCore(title) || "post";
}

// Tag names as typed by the author -> slug used to dedupe/upsert the tag
// row. Unlike slugifyTitle, this does NOT fall back to a placeholder: an
// unslugifiable tag name (emoji-only, CJK, Cyrillic) returning "" here means
// the tag input schema below rejects it, rather than every such tag
// silently collapsing onto the same "post" slug and merging into one
// unrelated tag.
export function tagToSlug(name: string): string {
  return slugifyCore(name);
}
