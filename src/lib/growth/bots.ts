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
 * DuckDuckGo browser ("DuckDuckGo/5"), Pinterest's in-app browser
 * ("[Pinterest/iOS]"), the Yandex app ("YandexSearch/"), the Slack and
 * Discord desktop apps ("Slack/4", "discord/1") and Telegram's in-app
 * browser ("Telegram-Android/10") are real people, and so is a Cubot phone
 * ("CUBOT X30").
 */

const BOT_PATTERN = new RegExp(
  [
    // Words ending in "bot" (Googlebot, PinterestBot, DuckDuckBot, ...), but not the Cubot phone brand.
    "(?<!cu)bot\\b",
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
    // WhatsApp's link unfurler ("WhatsApp/2.23.20.0 A"); its chats open links in the system browser.
    "^whatsapp/",
    "skypeuripreview",
    "slack-imgproxy",
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
    // Yandex crawlers not named "...bot" (YandexImages/3.0, YandexMetrika/2.0, ...), not the Yandex app or browser.
    "yandex(?!search|browser|app)[a-z]*/",
    "baiduspider",
    "petalbot",
    "bytespider",
    "gptbot",
    "claudebot",
    "anthropic-ai",
    "ccbot",
    "perplexity-user",
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
