// External author-supplied image URLs (design §8): https-only — browsers
// block http images on an https page anyway, and write-time validation only
// lands with ADM-6, so rendering guards here are the current boundary.
export function isRenderableImageSrc(
  src: string | null | undefined,
): src is string {
  return typeof src === "string" && src.startsWith("https://");
}

// Post-page hero source (POST-9): banner when set and renderable, else the
// card thumbnail, else nothing. One source of truth — the ADM-7 draft
// preview must show the same hero the public page does.
export function postHeroSrc(post: {
  bannerUrl: string | null;
  thumbnailUrl: string;
}): string | null {
  if (isRenderableImageSrc(post.bannerUrl)) return post.bannerUrl;
  if (isRenderableImageSrc(post.thumbnailUrl)) return post.thumbnailUrl;
  return null;
}
