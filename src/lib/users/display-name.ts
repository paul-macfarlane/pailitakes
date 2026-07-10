export const MAX_DISPLAY_NAME_LENGTH = 50;

// Single source of truth for display-name normalization (FR-10.2). Used by
// the auth database hooks (server boundary) and the account form.
// Returns the trimmed, whitespace-collapsed name, or null when nothing
// usable remains.
export function normalizeDisplayName(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

export function isValidDisplayName(raw: string): boolean {
  const normalized = normalizeDisplayName(raw);
  return normalized !== null && normalized.length <= MAX_DISPLAY_NAME_LENGTH;
}
