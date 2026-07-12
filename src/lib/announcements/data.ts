import "server-only";

// Pure DB access for the admin-only announcements domain (FR-6.1, FR-6.3).
// Business rules (not-found signaling, revalidation) live in
// src/lib/announcements/service.ts; the cached home-page read lives in
// src/lib/announcements/home.ts.

import { desc, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { announcements } from "@/db/schema";

export type AnnouncementRow = {
  id: string;
  body: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const announcementColumns = {
  id: announcements.id,
  body: announcements.body,
  expiresAt: announcements.expiresAt,
  createdAt: announcements.createdAt,
  updatedAt: announcements.updatedAt,
};

// Every announcement, expired or not — the admin management screen.
export async function listAllAnnouncements(): Promise<AnnouncementRow[]> {
  return db
    .select(announcementColumns)
    .from(announcements)
    .orderBy(desc(announcements.createdAt));
}

// Unexpired announcements only, for the public home page (FR-6.2). `now` is
// injectable for tests; callers use the default — mirrors
// visiblePostsWhere's now-injection idiom (src/lib/posts/posts.ts).
export async function listActiveAnnouncements(
  limit: number,
  now: Date = new Date(),
): Promise<AnnouncementRow[]> {
  return db
    .select(announcementColumns)
    .from(announcements)
    .where(
      or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(limit);
}

export async function insertAnnouncement(input: {
  body: string;
  expiresAt: Date | null;
}): Promise<AnnouncementRow> {
  const [row] = await db
    .insert(announcements)
    .values(input)
    .returning(announcementColumns);
  return row!;
}

// Returns undefined when `id` doesn't exist.
export async function updateAnnouncementRow(
  id: string,
  patch: { body: string; expiresAt: Date | null },
): Promise<AnnouncementRow | undefined> {
  const [row] = await db
    .update(announcements)
    .set(patch)
    .where(eq(announcements.id, id))
    .returning(announcementColumns);
  return row;
}

// Returns whether a row was actually deleted.
export async function deleteAnnouncementRow(id: string): Promise<boolean> {
  const rows = await db
    .delete(announcements)
    .where(eq(announcements.id, id))
    .returning({ id: announcements.id });
  return rows.length > 0;
}
