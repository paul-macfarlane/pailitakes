// Admin-only announcement input (FR-6.1, FR-6.3). No "server-only" here,
// same rationale as src/lib/categories/input.ts: nothing client-side needs
// these yet, but keeping the domain's zod schemas alongside its other pure
// code (rather than inline in the action) matches the posts/categories
// precedent.

import { z } from "zod";

export const ANNOUNCEMENT_MAX_LENGTH = 500;

export const announcementInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Announcement body is required.")
    .max(
      ANNOUNCEMENT_MAX_LENGTH,
      "Announcements are capped at 500 characters.",
    ),
});

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;
