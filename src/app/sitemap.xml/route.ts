import { cacheLife, cacheTag } from "next/cache";

import { listVisiblePostsForSitemap } from "@/lib/posts/posts";
import { env } from "@/lib/shared/env";

// Same tag/life as getHomeFeed (src/lib/posts/home-feed.ts): post mutations
// and the revalidation cron already call revalidateTag("post-list", ...)
// (design §3/§5.8), so this list invalidates alongside every other feed.
async function getSitemapEntries() {
  "use cache";
  cacheTag("post-list");
  cacheLife({ stale: 60, revalidate: 60 });

  return listVisiblePostsForSitemap();
}

// Slugs are constrained (see slug validation elsewhere), but escaping is
// cheap insurance against any value that reaches a <loc> ever containing
// XML-significant characters.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const posts = await getSitemapEntries();

  const urls = [
    `<url><loc>${xmlEscape(`${base}/`)}</loc></url>`,
    ...posts.map((post) => {
      const lastmod = (post.contentUpdatedAt ?? post.publishAt)?.toISOString();
      const loc = `<loc>${xmlEscape(`${base}/posts/${post.slug}`)}</loc>`;
      return `<url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    }),
  ].join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
