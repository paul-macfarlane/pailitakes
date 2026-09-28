import { REVIEW_STATUS_LABELS, ReviewStatus } from "@/lib/reviews/input";

// Submitted feedback is the one the owner should act on, so it gets the
// primary treatment (FR-7.16 owner indicator).
export function ReviewStatusBadge({ status }: { status: ReviewStatus | null }) {
  if (!status) return null;
  return (
    <span
      className={
        status === ReviewStatus.Submitted
          ? "rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
          : "rounded-full border px-2 py-0.5 text-xs font-medium"
      }
    >
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}
