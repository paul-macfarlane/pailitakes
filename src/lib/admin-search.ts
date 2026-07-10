import { z } from "zod";

// Single source of truth for the search-box cap: the zod schema below and the
// inputs' maxLength on both admin list pages import this, so client truncation
// and server validation can't drift.
export const SEARCH_QUERY_MAX = 100;

// Shared free-text search param for the admin list screens (posts + users).
// Blank/oversized/missing values all collapse to undefined (no filter), so a
// junk `q` never throws — it just disables the search.
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(SEARCH_QUERY_MAX)
  .optional()
  .catch(undefined);
