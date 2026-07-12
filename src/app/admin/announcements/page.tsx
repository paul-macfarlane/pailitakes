import type { Metadata } from "next";

import { AnnouncementCreateForm } from "@/app/admin/announcements/_components/announcement-create-form";
import { AnnouncementRowControls } from "@/app/admin/announcements/_components/announcement-row-controls";
import { listAllAnnouncements } from "@/lib/announcements/data";
import { Action } from "@/lib/auth/permissions";
import { requireCapability } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Announcements",
  robots: { index: false, follow: false },
};

// UTC-pinned to match the rest of the app's date rendering (e.g.
// src/app/admin/moderation/page.tsx); time-of-day matters here since
// expiresAt is compared against "now".
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

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
                    <time dateTime={announcement.createdAt.toISOString()}>
                      {/* This server-rendered list is UTC-pinned (avoids a
                          hydration mismatch), but the create/edit form's
                          expiration input is a browser-local
                          datetime-local — the " UTC" suffix disambiguates
                          the two clocks for the admin. */}
                      {dateFormat.format(announcement.createdAt)} UTC
                    </time>
                    {announcement.expiresAt ? (
                      <>
                        {" · Expires "}
                        <time dateTime={announcement.expiresAt.toISOString()}>
                          {dateFormat.format(announcement.expiresAt)} UTC
                        </time>
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
