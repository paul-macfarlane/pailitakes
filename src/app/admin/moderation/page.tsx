import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { ModerationRowControls } from "@/app/admin/moderation/_components/moderation-row-controls";
import { Button } from "@/components/ui/button";
import type { ModerationLogRow } from "@/lib/comments/data";
import { listModerationLog } from "@/lib/comments/service/moderation-log";
import { CommentStatus } from "@/lib/comments/status";
import { Action } from "@/lib/auth/permissions";
import { requireCapability } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Moderation log",
  robots: { index: false, follow: false },
};

// held/rejected only (design §5.2 "Moderation log (admin)") — visible/deleted
// comments have no verdict worth auditing here.
const filterSchema = z.object({
  status: z
    .enum([CommentStatus.Held, CommentStatus.Rejected])
    .catch(CommentStatus.Held),
  page: z.coerce.number().int().min(1).catch(1),
});

const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const STATUS_LABELS: Record<
  typeof CommentStatus.Held | typeof CommentStatus.Rejected,
  string
> = {
  [CommentStatus.Held]: "Held",
  [CommentStatus.Rejected]: "Rejected",
};

function VerdictSummary({ row }: { row: ModerationLogRow }) {
  if (!row.modVerdict) {
    return (
      <p className="text-xs text-muted-foreground">No verdict recorded.</p>
    );
  }
  if ("error" in row.modVerdict) {
    // Fail-closed to `held` (design §5.2 step 4): the moderation call itself
    // failed, not the comment — say so plainly rather than implying a
    // content verdict.
    return (
      <p className="text-xs text-muted-foreground">
        Moderation failure: {row.modVerdict.error} ({row.modVerdict.model},{" "}
        {row.modVerdict.latencyMs}ms)
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Verdict: {row.modVerdict.verdict} — {row.modVerdict.reason} (
      {row.modVerdict.model}, {row.modVerdict.latencyMs}ms)
    </p>
  );
}

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability(Action.ModerateComments, "/admin/moderation");
  const filters = filterSchema.parse(await searchParams);

  const { rows, hasMore } = await listModerationLog({
    status: filters.status,
    page: filters.page,
  });

  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (filters.status !== CommentStatus.Held) {
      params.set("status", filters.status);
    }
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/admin/moderation?${query}` : "/admin/moderation";
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Moderation log</h1>

      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        {/* Native <select>: same server-rendered, zero-JS GET filter form as
            /admin/users (src/app/admin/users/page.tsx) — a shadcn Select is a
            client-side control that would require converting the whole form
            to a client island for no functional gain. Monitoring-only screen
            (design §5.2), so there's no search box to pair it with. */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={filters.status}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value={CommentStatus.Held}>Held</option>
            <option value={CommentStatus.Rejected}>Rejected</option>
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          {filters.page > 1
            ? "No comments on this page — go back a page."
            : filters.status === CommentStatus.Held
              ? "No held comments — nothing awaiting review."
              : "No rejected comments logged."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {row.author.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      on{" "}
                      <Link
                        href={`/posts/${row.post.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {row.post.title}
                      </Link>
                    </span>
                  </p>
                  {/* Names aren't unique — the email disambiguates which
                      account posted this comment (admin-only screen, so
                      showing this PII here is fine). */}
                  <p className="text-xs text-muted-foreground">
                    {row.author.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateFormat.format(row.createdAt)} UTC
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                  {/* listModerationLogRows filters WHERE status = params.status
                      (src/lib/comments/data.ts), so every row on this page
                      shares filters.status — index off that rather than
                      row.status, whose declared type is the full
                      CommentStatus union. */}
                  {STATUS_LABELS[filters.status]}
                </span>
              </div>
              {/* Comments are plain text (engineering rules), so raw
                  interpolation is safe — React escapes it; whitespace-pre-wrap
                  just preserves the author's line breaks. Clamped since this
                  screen is for monitoring, not reading every word. */}
              <p className="line-clamp-4 text-sm whitespace-pre-wrap">
                {row.body}
              </p>
              <VerdictSummary row={row} />
              {/* filters.status, not row.status: every row on this page
                  shares it (see the status badge comment above), and it
                  determines which action (Approve vs Restore) applies. */}
              <ModerationRowControls id={row.id} status={filters.status} />
            </li>
          ))}
        </ul>
      )}

      {(filters.page > 1 || hasMore) && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {filters.page > 1 ? (
            <Link href={pageHref(filters.page - 1)} className="hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link href={pageHref(filters.page + 1)} className="hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
