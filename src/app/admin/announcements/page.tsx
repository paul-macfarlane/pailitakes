import type { Metadata } from "next";

import { AnnouncementCreateForm } from "@/app/admin/announcements/_components/announcement-create-form";
import { AnnouncementRowControls } from "@/app/admin/announcements/_components/announcement-row-controls";
import { LocalDate } from "@/components/local-date";
import { listAllAnnouncements } from "@/lib/announcements/data";
import { Action } from "@/lib/auth/permissions";
import { requireCapability } from "@/lib/auth/session";
import { DateDisplay } from "@/lib/shared/datetime";

export const metadata: Metadata = {
  title: "Announcements",
  robots: { index: false, follow: false },
};

// Admin-only site-wide announcement management (FR-6.1, FR-6.3). Same
// requireCapability/notFound() pattern as /admin/categories — a staff-but-
// non-admin author gets a 404 here.
export default async function AdminAnnouncementsPage() {
  await requireCapability(Action.ManageAnnouncements, "/admin/announcements");
  const announcements = await listAllAnnouncements();
  const now = new Date();

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Announcements</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Site-wide banners shown on the home page, newest first.
      </p>

      <AnnouncementCreateForm />

      {announcements.length === 0 ? (
        <p className="text-muted-foreground">No announcements yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {announcements.map((announcement) => {
            const expired =
              announcement.expiresAt !== null && announcement.expiresAt <= now;

            return (
              <li key={announcement.id} className="flex flex-col gap-3 p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="line-clamp-2 text-sm">
                      {announcement.body}
                    </span>
                    {expired ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Expired
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Posted{" "}
                    <LocalDate
                      iso={announcement.createdAt.toISOString()}
                      display={DateDisplay.DateTime}
                    />
                    {announcement.expiresAt ? (
                      <>
                        {" · Expires "}
                        <LocalDate
                          iso={announcement.expiresAt.toISOString()}
                          display={DateDisplay.DateTime}
                        />
                      </>
                    ) : null}
                  </p>
                </div>
                <AnnouncementRowControls
                  id={announcement.id}
                  body={announcement.body}
                  expiresAt={announcement.expiresAt}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
