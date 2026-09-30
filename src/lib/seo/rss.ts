/**
 * RSS 2.0 feed builder (pure). Text is XML-escaped and control characters
 * that XML 1.0 forbids are removed, so user content can never break the feed.
 */

export interface RssItem {
  title: string;
  /** Absolute URL. */
  link: string;
  description: string;
  /** ISO date-time. */
  pubDate: string;
  author?: string;
  categories?: string[];
  /** Absolute image URL (sent as an enclosure). */
  image?: string;
}

export interface RssChannel {
  title: string;
  /** Absolute URL of the HTML page the feed mirrors. */
  link: string;
  /** Absolute URL of the feed itself (atom:link rel=self). */
  feedUrl: string;
  description: string;
  language?: string;
  items: RssItem[];
}

// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
}

function imageType(url: string): string {
  const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export function buildRss(channel: RssChannel): string {
  const lastBuild = channel.items.reduce<string | null>((max, i) => (!max || i.pubDate > max ? i.pubDate : max), null);
  const items = channel.items
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
        `      <pubDate>${rfc822(item.pubDate)}</pubDate>`,
        item.author ? `      <dc:creator>${escapeXml(item.author)}</dc:creator>` : "",
        ...(item.categories ?? []).map((c) => `      <category>${escapeXml(c)}</category>`),
        `      <description>${escapeXml(item.description)}</description>`,
        item.image ? `      <enclosure url="${escapeXml(item.image)}" length="0" type="${imageType(item.image)}" />` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <language>${escapeXml(channel.language ?? "en")}</language>`,
    `    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml" />`,
    lastBuild ? `    <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>` : "",
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n");
}

/** HTTP response for a feed (cached briefly by browsers and CDNs). */
export function rssResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
