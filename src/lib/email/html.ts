/**
 * String helpers for building email HTML safely: escaping, URL allow-lists,
 * color handling and an HTML → plain-text converter for the text/plain part.
 *
 * Pure module (no Node or app imports) so it can be unit-tested directly.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML element content or a quoted attribute value. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

/** Alias that reads better at attribute call sites. */
export const escapeAttr = escapeHtml;

/** Escape text and turn line breaks into `<br>`. */
export function escapeMultiline(value: string): string {
  return escapeHtml(value.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/** Browsers ignore ASCII whitespace and control characters inside a URL scheme ("java\tscript:"). */
function compactUrl(url: string): string {
  // eslint-disable-next-line no-control-regex
  return url.replace(/[\u0000- \u007f-\u009f]/g, "");
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Resolve a link for an email: absolute `http(s):` and `mailto:` URLs are
 * kept, app-relative paths ("/courses/x") are made absolute against
 * `baseUrl`, everything else (javascript:, data:, protocol-relative "//x",
 * bare fragments, relative "page.html") is rejected with `null`.
 */
export function safeLinkUrl(url: string | undefined | null, baseUrl: string): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  const compact = compactUrl(raw);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme) {
    const s = scheme[1]!.toLowerCase();
    if (s !== "http" && s !== "https" && s !== "mailto") return null;
    if (s === "mailto") return /^mailto:[^\s<>"]+$/i.test(compact) ? compact : null;
    try {
      const parsed = new URL(compact);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }
  if (compact.startsWith("/") && !compact.startsWith("//") && !compact.startsWith("/\\")) {
    try {
      const parsed = new URL(compact, `${trimBase(baseUrl)}/`);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Like `safeLinkUrl` but only for images: http(s) or app-relative paths. */
export function safeImageUrl(url: string | undefined | null, baseUrl: string): string | null {
  const resolved = safeLinkUrl(url, baseUrl);
  return resolved && /^https?:/i.test(resolved) ? resolved : null;
}

/** Make an app path absolute ("/courses" → "https://lms.example.com/courses"). */
export function absoluteUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${trimBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

/** Normalize "#abc" / "#AABBCC" to "#aabbcc"; null for anything else. */
export function normalizeHexColor(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Black or white, whichever reads better on the given background. */
export function readableTextColor(background: string): string {
  const bg = normalizeHexColor(background) ?? "#4f46e5";
  const l = luminance(bg);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (luminance("#111827") + 0.05);
  return contrastWhite >= contrastDark ? "#ffffff" : "#111827";
}

/* ------------------------------------------------------------------ */
/* HTML → text                                                         */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  zwnj: "",
  zwj: "",
  shy: "",
};

/** Decode named (common) and numeric HTML entities. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      if (code === 847) return ""; // combining grapheme joiner used in preheader padding
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Convert an HTML email body to a readable plain-text alternative: drops
 * head/style/script and the hidden preheader, keeps paragraph and list
 * structure, renders links as "text (url)", decodes entities and trims
 * excess whitespace.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(head|style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(div|span|p)\b[^>]*\bdata-preheader\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // Collapse source formatting whitespace; structure comes from tags below.
  s = s.replace(/\s+/g, " ");
  s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, dq: string | undefined, sq: string | undefined, inner: string) => {
    const href = decodeEntities((dq ?? sq ?? "").trim());
    const label = decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#")) return label;
    const bareHref = href.replace(/^mailto:/i, "");
    if (!label || label === href || label === bareHref) return bareHref;
    return `${label} (${href})`;
  });
  s = s.replace(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_m, dq: string | undefined, sq: string | undefined) => {
    const alt = (dq ?? sq ?? "").trim();
    return alt ? `[${alt}]` : "";
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr\b[^>]*>/gi, "\n----------------------------------------\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(td|th)\s*>/gi, "  ");
  s = s.replace(/<\/?(tr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/?(p|div|h[1-6]|table|tbody|thead|blockquote|pre|ul|ol|section|article|header|footer)\b[^>]*>/gi, "\n\n");
  s = stripTags(s);
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
