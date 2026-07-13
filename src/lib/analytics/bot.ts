import "server-only";

// Basic bot filter (design §5.6): the beacon requiring JS already filters
// most scrapers, this drops the honest self-identified ones (search-engine
// crawlers, uptime monitors, common HTTP client libraries). Not
// adversarial-proof by design — a bot spoofing a real browser UA sails
// through, and that's an accepted trade-off at this scale.
const BOT_MARKERS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "headlesschrome",
  "lighthouse",
  "pingdom",
  "facebookexternalhit",
  "bingpreview",
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "node-fetch",
  "axios",
  "go-http-client",
  "java/",
  "okhttp",
];

export function isKnownBotUserAgent(userAgent: string): boolean {
  const trimmed = userAgent.trim();
  if (trimmed === "") return true;
  const lower = trimmed.toLowerCase();
  return BOT_MARKERS.some((marker) => lower.includes(marker));
}
