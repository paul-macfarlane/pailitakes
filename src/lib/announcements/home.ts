import "server-only";

// Cached public home-page read for announcements (FR-6.2). Kept in its own
// file, separate from src/lib/announcements/service.ts's mutations — mirrors
// the posts domain's split between src/lib/posts/home-feed.ts ("use cache")
// and src/lib/posts/service/crud.ts (revalidateTag), so a build-time
// "use cache" directive never shares a module with a revalidateTag caller.

import { cacheLife, cacheTag } from "next/cache";

import { listActiveAnnouncements } from "@/lib/announcements/data";
import { renderMarkdown } from "@/lib/content/markdown";

// FR-6.2 says "most recent 3–5"; 3 keeps the mobile-first homepage tight.
export const HOME_ANNOUNCEMENTS_LIMIT = 3;

export type HomeAnnouncement = { id: string; html: string; createdAt: Date };

// Cached per the `announcements` tag (design §3): create/edit/delete
// mutations invalidate every cached reader in one revalidateTag call; 60s
// revalidation is the expiration safety net, matching post ISR semantics.
export async function getHomeAnnouncements(): Promise<HomeAnnouncement[]> {
  "use cache";
  cacheTag("announcements");
  cacheLife({ stale: 60, revalidate: 60 });

  const rows = await listActiveAnnouncements(HOME_ANNOUNCEMENTS_LIMIT);
  // Markdown renders inside the cached scope so it runs once per
  // revalidation window, not once per request (design §5.1). Expired items
  // drop within <=60s via revalidate rather than being pruned eagerly.
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      html: await renderMarkdown(row.body),
      createdAt: row.createdAt,
    })),
  );
}
