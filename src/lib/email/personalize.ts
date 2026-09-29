/**
 * Render a markdown message once and personalise it per recipient.
 *
 * Bulk emails (announcements, batch messages) share one body whose
 * placeholders differ per member (`{{ member_name }}`, `{{ member_email }}`).
 * Parsing the markdown for every recipient multiplied the cost by the
 * audience size, so instead:
 *
 *  1. audience-wide placeholders are filled into the markdown source —
 *     text values markdown-escaped, app-generated URLs (`{{ batch_url }}`)
 *     inserted as plain URLs so they autolink like in the in-app preview;
 *  2. member placeholders become random alphanumeric sentinels, which pass
 *     through the markdown renderer and HTML escaping unchanged;
 *  3. the markdown is rendered to HTML and text once;
 *  4. `personalize` swaps the sentinels for each member's values: HTML-escaped
 *     in the HTML (and percent-encoded inside href/src attributes), raw in
 *     the text part. Values are inserted after parsing, so a name can never
 *     add formatting, links or markup.
 *
 * Pure module (Node's crypto only).
 */
import { randomBytes } from "node:crypto";
import { escapeHtml } from "./html";
import { escapeMarkdown, markdownToEmailHtml, markdownToText } from "./markdown";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Placeholders whose value differs per recipient. */
export const MEMBER_PLACEHOLDERS = ["member_name", "member_email"] as const;
/** Placeholders holding absolute app URLs (inserted unescaped so they render as links). */
export const URL_PLACEHOLDERS = ["batch_url", "course_url"] as const;

/** Replace `{{ key }}` placeholders; unknown keys are left as written. */
export function fillPlaceholders(text: string, values: Record<string, string>, escape: (value: string) => string = (v) => v): string {
  return text.replace(PLACEHOLDER_RE, (match, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? escape(values[key]!) : match));
}

/**
 * Percent-encode every character of a URL that has a meaning in markdown
 * (`_ * ~ ( ) [ ] ! ' < > \` and whitespace…), so the URL can be dropped into
 * markdown source verbatim and still autolink. Only used for trusted,
 * app-generated URLs.
 */
export function markdownSafeUrl(url: string): string {
  return url.replace(/[^A-Za-z0-9\-.:/?#@$&+,;=%]/gu, (ch) => {
    try {
      const encoded = encodeURIComponent(ch);
      return encoded === ch ? `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}` : encoded;
    } catch {
      return "";
    }
  });
}

export interface PreparedMarkdown {
  html: string;
  text: string;
  /** Placeholder key → sentinel standing in for it in `html`/`text`. */
  sentinels: Record<string, string>;
}

export interface PrepareOptions {
  /** Audience-wide placeholder values. */
  values: Record<string, string>;
  /** Keys filled per recipient by `personalize` (default: member name and email). */
  personalKeys?: readonly string[];
  /** Keys whose values are trusted absolute URLs (default: batch and course URL). */
  urlKeys?: readonly string[];
  baseUrl: string;
  accentColor?: string;
  /** Fixed sentinel nonce (tests only). */
  nonce?: string;
}

/** Fill audience-wide placeholders and render the markdown once. */
export function prepareMarkdown(markdown: string, opts: PrepareOptions): PreparedMarkdown {
  const nonce = (opts.nonce ?? randomBytes(8).toString("hex")).replace(/[^a-z0-9]/gi, "").toLowerCase() || "x";
  const personal = opts.personalKeys ?? MEMBER_PLACEHOLDERS;
  const urlKeys = opts.urlKeys ?? URL_PLACEHOLDERS;
  const sentinels: Record<string, string> = {};
  personal.forEach((key, index) => {
    sentinels[key] = `llph${nonce}k${index}z`;
  });
  const source = markdown.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(sentinels, key)) return sentinels[key]!;
    if (!Object.prototype.hasOwnProperty.call(opts.values, key)) return match;
    const value = opts.values[key]!;
    return urlKeys.includes(key) && /^https?:\/\//i.test(value) ? markdownSafeUrl(value) : escapeMarkdown(value);
  });
  return {
    html: markdownToEmailHtml(source, { baseUrl: opts.baseUrl, accentColor: opts.accentColor }),
    text: markdownToText(source, { baseUrl: opts.baseUrl }),
    sentinels,
  };
}

const ATTR_URL_RE = /(\s(?:href|src)=")([^"]*)(")/g;
const TEXT_URL_RE = /\b(?:https?:\/\/|mailto:)[^\s<>"]*/gi;

/** Swap the sentinels for one recipient's values. Linear in the body size. */
export function personalize(prepared: PreparedMarkdown, values: Record<string, string>): { html: string; text: string } {
  const bySentinel = new Map<string, string>();
  for (const [key, sentinel] of Object.entries(prepared.sentinels)) {
    bySentinel.set(sentinel, (values[key] ?? "").replace(/[\r\n]+/g, " "));
  }
  if (!bySentinel.size) return { html: prepared.html, text: prepared.text };
  const re = new RegExp(Array.from(bySentinel.keys()).join("|"), "g");
  const value = (s: string) => bySentinel.get(s) ?? "";
  const inUrl = (s: string) => {
    try {
      return encodeURIComponent(value(s));
    } catch {
      return "";
    }
  };
  const html = prepared.html
    .replace(ATTR_URL_RE, (_m, open: string, url: string, close: string) => `${open}${url.replace(re, (s) => escapeHtml(inUrl(s)))}${close}`)
    .replace(re, (s) => escapeHtml(value(s)));
  const text = prepared.text.replace(TEXT_URL_RE, (url) => url.replace(re, inUrl)).replace(re, value);
  return { html, text };
}
