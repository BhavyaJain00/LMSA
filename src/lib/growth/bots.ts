/**
 * User-agent bot filter for first-party tracking (referral clicks and page
 * views). Pure and isomorphic.
 *
 * Crawlers, link unfurlers (chat apps, social networks), uptime monitors,
 * headless browsers and HTTP libraries are not visitors; counting them would
 * inflate clicks and skew funnels. An empty user agent is treated as a bot
 * too — every real browser sends one.
 *
 * Crawlers are matched by their crawler names, never by a brand alone: the
 * DuckDuckGo browser ("DuckDuckGo/5") and Pinterest's in-app browser
 * ("[Pinterest/iOS]") are real people.
 */

const BOT_PATTERN = new RegExp(
  [
    // Words ending in "bot" (Googlebot, PinterestBot, DuckDuckBot, ...), but not the Cubot phone brand.
    "(?<!cu)bot\\b",
    "(?<!cu)bot/",
    "crawl",
    "spider",
    "slurp",
    "scrap",
    "fetch",
    "preview",
    "facebookexternalhit",
    "facebookcatalog",
    "embedly",
    "quora link",
    "outbrain",
    "vkshare",
    "w3c_validator",
    "whatsapp",
    "telegram",
    "skypeuripreview",
    "slack",
    "discord",
    "bitlybot",
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "pingdom",
    "uptime",
    "monitor",
    "statuscake",
    "headless",
    "phantomjs",
    "puppeteer",
    "playwright",
    "selenium",
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "aiohttp",
    "httpx",
    "go-http-client",
    "java/",
    "okhttp",
    "libwww",
    "node-fetch",
    "undici",
    "axios/",
    "postmanruntime",
    "insomnia",
    "httpclient",
    "apache-httpclient",
    "feedfetcher",
    "rss",
    "mediapartners",
    "adsbot",
    "google-inspectiontool",
    "chrome-lighthouse",
    "yandex",
    "baiduspider",
    "petalbot",
    "bytespider",
    "gptbot",
    "claudebot",
    "anthropic-ai",
    "ccbot",
    "perplexity",
    "applebot",
    "semrush",
    "ahrefs",
    "mj12",
    "dotbot",
    "archive\\.org",
  ].join("|"),
  "i",
);

/** True for crawlers, unfurlers, monitors, headless browsers, scripts and missing user agents. */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (ua.length < 8) return true;
  return BOT_PATTERN.test(ua);
}
