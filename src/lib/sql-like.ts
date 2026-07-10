// Escape LIKE/ILIKE wildcards so user-supplied search text matches literally.
// The value is already parameterized (no injection risk), but a bare % or _
// would otherwise act as a wildcard. Postgres uses backslash as the default
// LIKE escape character.
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
