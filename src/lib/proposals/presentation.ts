import { ProposalOrigin, ProposalStatus } from "./input";
import type { MetadataField } from "./diff";
import type { ProposalSnapshot } from "./input";

export const PROPOSAL_STATUS_LABELS = {
  [ProposalStatus.Open]: "Open review",
  [ProposalStatus.Applied]: "Applied review",
  [ProposalStatus.Rejected]: "Rejected review",
  [ProposalStatus.Superseded]: "Replaced review",
};
export const FIELD_LABELS: Record<MetadataField, string> = {
  title: "Title",
  slug: "Slug",
  categoryId: "Category",
  tags: "Tags",
  thumbnailUrl: "Thumbnail URL",
  bannerUrl: "Banner URL",
  videoUrl: "Video URL",
};
export type ReviewCategory = { id: number; name: string };
export function displayField(
  field: MetadataField,
  value: ProposalSnapshot[MetadataField],
  categories: ReviewCategory[],
): string {
  if (field === "categoryId")
    return (
      categories.find((category) => category.id === value)?.name ??
      `Category ${value} (unavailable)`
    );
  if (Array.isArray(value)) return value.join(", ") || "(none)";
  return value === null || value === "" ? "(empty)" : String(value);
}

// Neutral Reviews naming with explicit attribution (ADR-0036/0038).
export function reviewAttribution(review: {
  origin: string;
  agentLabel: string | null;
  reviewerName: string | null;
}): string {
  return review.origin === ProposalOrigin.Human
    ? `Human · ${review.reviewerName}`
    : `AI · ${review.agentLabel}`;
}
