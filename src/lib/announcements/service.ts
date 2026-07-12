import "server-only";

// Business logic for the admin-only announcements CRUD screen (FR-6.1,
// FR-6.3). DB access lives in src/lib/announcements/data.ts; the cached
// public home-page read lives in src/lib/announcements/home.ts — kept out of
// this module so a build-time "use cache" directive never shares a file with
// a revalidateTag-calling mutation (mirrors the posts domain's split between
// src/lib/posts/service/crud.ts and src/lib/posts/home-feed.ts).

import { revalidateTag } from "next/cache";

import {
  deleteAnnouncementRow,
  insertAnnouncement,
  updateAnnouncementRow,
} from "@/lib/announcements/data";
import { GENERIC_ERROR, type ActionResult } from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";

function revalidateAnnouncementReads(): void {
  revalidateTag("announcements", IMMEDIATE);
}

export async function createAnnouncement(input: {
  body: string;
  expiresAt: Date | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const row = await insertAnnouncement(input);
    revalidateAnnouncementReads();
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    console.error("createAnnouncement failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function updateAnnouncement(
  id: string,
  input: { body: string; expiresAt: Date | null },
): Promise<ActionResult<{ id: string }>> {
  try {
    const row = await updateAnnouncementRow(id, input);
    if (!row) {
      return { ok: false, error: "Announcement not found." };
    }

    revalidateAnnouncementReads();
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    console.error("updateAnnouncement failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function deleteAnnouncement(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const deleted = await deleteAnnouncementRow(id);
    if (!deleted) {
      return { ok: false, error: "Announcement not found." };
    }

    revalidateAnnouncementReads();
    return { ok: true, data: { id } };
  } catch (err) {
    console.error("deleteAnnouncement failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
