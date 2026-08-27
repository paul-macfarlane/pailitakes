"use client";

import { LocalDate, useViewerTimeZone } from "@/components/local-date";
import { showsUpdatedDate } from "@/lib/posts/status";

// The post byline's date pair (post-article.tsx). Separate island from
// LocalDate because "Updated" is conditional on the viewer's zone, not just
// formatted in it: same-local-day edits are suppressed (SEO-9, ADR-0028), so
// the decision has to run where the zone is known. Server fallback decides
// in UTC; the client re-decides after hydration.
export function PostDates({
  publishAt,
  contentUpdatedAt,
}: {
  publishAt: string;
  contentUpdatedAt: string | null;
}) {
  const timeZone = useViewerTimeZone();
  const updatedAt =
    contentUpdatedAt !== null &&
    showsUpdatedDate(new Date(publishAt), new Date(contentUpdatedAt), timeZone)
      ? contentUpdatedAt
      : null;
  return (
    <>
      {" · "}
      <LocalDate iso={publishAt} />
      {updatedAt && (
        <>
          {" · Updated "}
          <LocalDate iso={updatedAt} />
        </>
      )}
    </>
  );
}
