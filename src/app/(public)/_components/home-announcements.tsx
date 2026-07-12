import { getHomeAnnouncements } from "@/lib/announcements/home";

// UTC-pinned, same rationale as PostCard (src/components/post-card.tsx):
// server-rendered results must show the same date regardless of viewer
// timezone.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

// Homepage announcements section (FR-6.2): a dedicated, newest-first section
// showing the most recent few active announcements. Ordering/limit/hiding of
// expired items is entirely getHomeAnnouncements's responsibility (cached,
// tagged "announcements"); this component only renders what it returns.
// `mt-6` lives on the section itself (not a wrapper in page.tsx) so an empty
// render contributes zero spacing to the page.
export async function HomeAnnouncements() {
  const announcements = await getHomeAnnouncements();

  if (announcements.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="home-announcements-heading" className="mt-6">
      <h2
        id="home-announcements-heading"
        className="text-sm font-semibold text-foreground"
      >
        Announcements
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {announcements.map((announcement) => (
          <li
            key={announcement.id}
            className="rounded-lg border bg-card px-4 py-3"
          >
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              // Sanitized by rehype-sanitize in renderMarkdown (design §5.1),
              // same pipeline as post-body.tsx.
              dangerouslySetInnerHTML={{ __html: announcement.html }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              <time dateTime={announcement.createdAt.toISOString()}>
                {dateFormat.format(announcement.createdAt)}
              </time>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
