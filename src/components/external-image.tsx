import Image from "next/image";

import { isRenderableImageSrc } from "@/lib/content/image-src";

// The one way external author-supplied images render (design §8): https-only
// (see isRenderableImageSrc), `unoptimized` (no wildcard remotePatterns),
// filling the caller's positioned container. Renders nothing for
// non-renderable values — callers deciding whether to show the container at
// all should check isRenderableImageSrc first.
export function ExternalImage({
  src,
  alt = "",
  priority = false,
}: {
  src: string;
  alt?: string;
  priority?: boolean;
}) {
  if (!isRenderableImageSrc(src)) return null;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      priority={priority}
      className="object-cover"
    />
  );
}
