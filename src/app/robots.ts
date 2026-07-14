import type { MetadataRoute } from "next";

import { env } from "@/lib/shared/env";

// Design §5.8 names only /admin as disallowed — no other paths.
export default function robots(): MetadataRoute.Robots {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      disallow: "/admin",
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
