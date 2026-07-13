import { describe, expect, it } from "vitest";

import { isKnownBotUserAgent } from "./bot";

describe("isKnownBotUserAgent", () => {
  it.each([
    [
      "Googlebot",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ],
    ["curl/8.x", "curl/8.4.0"],
    ["empty string", ""],
    ["whitespace only", "   "],
    [
      "Bingbot",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    ],
    ["Lighthouse", "Mozilla/5.0 Chrome-Lighthouse"],
    [
      "facebookexternalhit",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    ],
    ["Pingdom", "Pingdom.com_bot_version_1.4"],
    ["python-requests", "python-requests/2.31.0"],
    ["python-urllib", "Python-urllib/3.11"],
    ["node-fetch", "node-fetch"],
    ["axios", "axios/1.6.0"],
    ["Go-http-client", "Go-http-client/1.1"],
    ["Java/", "Java/17.0.1"],
    ["okhttp", "okhttp/4.9.0"],
    ["wget", "Wget/1.21.3"],
    ["headless Chrome", "Mozilla/5.0 HeadlessChrome/120.0.0.0"],
  ])("flags %s as a bot", (_label, ua) => {
    expect(isKnownBotUserAgent(ua)).toBe(true);
  });

  it.each([
    [
      "Chrome desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    [
      "Safari iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox mobile",
      "Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0",
    ],
    [
      "Chrome Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    ],
  ])("does not flag %s", (_label, ua) => {
    expect(isKnownBotUserAgent(ua)).toBe(false);
  });
});
