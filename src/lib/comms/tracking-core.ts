/**
 * Email open and click tracking: the pure building blocks.
 *
 *  - Open pixel: `/api/email/o/<emailId>.<sig>.gif`, a 1×1 GIF whose URL is
 *    signed so nobody can record opens for someone else's email.
 *  - Click redirect: `/api/email/c/<emailId>?u=<url>&s=<sig>`, where the
 *    signature covers the email id AND the exact destination. The redirect
 *    only ever goes to a URL that was written into that email, so the
 *    endpoint can't be abused as an open redirect.
 *
 * Signatures are HMAC-SHA256 (keyed by the caller — the server derives the
 * key from APP_SECRET, see `tracking.ts`) truncated to 128 bits and compared
 * in constant time. Everything here is deterministic and free of Next and
 * store imports so it can be unit tested.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailEvent } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Signatures                                                          */
/* ------------------------------------------------------------------ */

/** 22 base64url characters = 132 bits of the HMAC. */
export const SIGNATURE_LENGTH = 22;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{22}$/;
/** Outbox ids look like `eml_…`; accept any short URL-safe id without dots. */
const EMAIL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Longest destination URL we track (longer links are left untouched). */
export const MAX_TRACKED_URL_LENGTH = 2048;

export type TrackingKey = string | Buffer;

function sign(key: TrackingKey, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

function signaturesEqual(expected: string, candidate: string | null | undefined): boolean {
  if (typeof candidate !== "string" || !SIGNATURE_RE.test(candidate)) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isTrackableEmailId(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_ID_RE.test(value);
}

export function openSignature(key: TrackingKey, emailId: string): string {
  return sign(key, `open\n${emailId}`);
}

export function clickSignature(key: TrackingKey, emailId: string, url: string): string {
  return sign(key, `click\n${emailId}\n${url}`);
}

export function verifyOpenSignature(key: TrackingKey, emailId: string | null | undefined, signature: string | null | undefined): boolean {
  if (!isTrackableEmailId(emailId)) return false;
  return signaturesEqual(openSignature(key, emailId), signature);
}

/**
 * True only for the exact (email, destination) pair the signature was made
 * for, and only when the destination is a safe http(s) URL.
 */
export function verifyClickSignature(
  key: TrackingKey,
  emailId: string | null | undefined,
  url: string | null | undefined,
  signature: string | null | undefined,
): boolean {
  if (!isTrackableEmailId(emailId) || typeof url !== "string" || !isSafeRedirectUrl(url)) return false;
  return signaturesEqual(clickSignature(key, emailId, url), signature);
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function pixelUrl(baseUrl: string, key: TrackingKey, emailId: string): string {
  return `${trimBase(baseUrl)}/api/email/o/${emailId}.${openSignature(key, emailId)}.gif`;
}

export function clickUrl(baseUrl: string, key: TrackingKey, emailId: string, url: string): string {
  const q = new URLSearchParams({ u: url, s: clickSignature(key, emailId, url) });
  return `${trimBase(baseUrl)}/api/email/c/${emailId}?${q.toString()}`;
}

/** Split the pixel route parameter `<emailId>.<sig>.gif`; null when malformed. */
export function parsePixelParam(param: string | null | undefined): { emailId: string; signature: string } | null {
  if (typeof param !== "string" || param.length > 120) return null;
  const match = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{22})\.gif$/.exec(param);
  return match ? { emailId: match[1]!, signature: match[2]! } : null;
}

/**
 * A destination the click endpoint may redirect to: an absolute http(s) URL
 * without embedded credentials, whitespace or control characters.
 */
export function isSafeRedirectUrl(url: string): boolean {
  if (!url || url.length > MAX_TRACKED_URL_LENGTH) return false;
  // Raw whitespace, control characters or backslashes can make browsers and URL parsers disagree.
  if (/[\s\u0000-\u001f\u007f\\]/.test(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return !!parsed.hostname;
}

/** App paths that must never be wrapped: unsubscribe/preferences, confirmation links and the trackers themselves. */
const UNTRACKED_PATHS = ["/settings/notifications", "/api/email/", "/free/unsubscribe", "/free/confirm", "/reset-password", "/verify-email"];

/** Whether a link in a marketing email should go through the click tracker. */
export function isTrackableUrl(url: string, appUrl: string): boolean {
  if (!isSafeRedirectUrl(url)) return false;
  let parsed: URL;
  let app: URL;
  try {
    parsed = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  // Links that carry one-time tokens stay direct (secrets never pass through the tracker's query string).
  if (/[?&]token=/i.test(url)) return false;
  if (parsed.origin === app.origin) {
    const path = parsed.pathname;
    if (UNTRACKED_PATHS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* HTML rewriting                                                      */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the entities that can appear in an attribute value. */
export function decodeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function encodeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ANCHOR_HREF_RE = /(<a\b[^>]*?\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Rewrite the `href` of every `<a>` element. `wrap` receives the decoded URL
 * and returns the replacement, or null to keep the link as it is.
 */
export function rewriteLinks(html: string, wrap: (url: string) => string | null): string {
  return html.replace(ANCHOR_HREF_RE, (match, prefix: string, double?: string, single?: string) => {
    const raw = double ?? single ?? "";
    const replacement = wrap(decodeAttribute(raw.trim()));
    return replacement === null ? match : `${prefix}"${encodeAttribute(replacement)}"`;
  });
}

/** Markup of the invisible open pixel. */
export function pixelTag(src: string): string {
  return `<img src="${encodeAttribute(src)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;max-width:1px;max-height:1px;border:0;margin:0;padding:0;overflow:hidden" />`;
}

/** Insert the pixel right before `</body>` (or at the end of a fragment). */
export function injectPixel(html: string, src: string): string {
  const tag = pixelTag(src);
  // The LAST closing body tag, in case the content quotes one.
  const last = html.toLowerCase().lastIndexOf("</body");
  return last === -1 ? `${html}${tag}` : `${html.slice(0, last)}${tag}${html.slice(last)}`;
}

export interface TrackingInjection {
  baseUrl: string;
  key: TrackingKey;
  emailId: string;
  opens: boolean;
  clicks: boolean;
}

/** Add the pixel and/or wrap the links of a rendered email for one outbox message. */
export function applyTracking(html: string, opts: TrackingInjection): string {
  if (!html.trim() || !isTrackableEmailId(opts.emailId)) return html;
  let out = html;
  if (opts.clicks) {
    out = rewriteLinks(out, (url) => (isTrackableUrl(url, opts.baseUrl) ? clickUrl(opts.baseUrl, opts.key, opts.emailId, url) : null));
  }
  if (opts.opens) out = injectPixel(out, pixelUrl(opts.baseUrl, opts.key, opts.emailId));
  return out;
}

const PIXEL_TAG_RE = /<img\b[^>]*?\ssrc\s*=\s*["'][^"']*\/api\/email\/o\/[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{22}\.gif["'][^>]*>/gi;
const CLICK_URL_RE = /https?:\/\/[^"'\s<>]*?\/api\/email\/c\/[A-Za-z0-9_-]{1,64}\?u=([^&"'\s<>]*)(?:&amp;|&)s=[A-Za-z0-9_-]{22}/gi;

/**
 * Undo `applyTracking` for display (admin previews): drop the pixel and point
 * wrapped links straight at their destination, so staff viewing a message
 * never record an open or a click on the recipient's behalf.
 */
export function stripTracking(html: string): string {
  if (!html.includes("/api/email/")) return html;
  return html.replace(PIXEL_TAG_RE, "").replace(CLICK_URL_RE, (match, encoded: string) => {
    try {
      const url = decodeURIComponent(encoded.replace(/\+/g, " "));
      return isSafeRedirectUrl(url) ? encodeAttribute(url) : match;
    } catch {
      return match;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Campaign references (EmailMessage.trackingId)                       */
/* ------------------------------------------------------------------ */

export type TrackingRef = { kind: "broadcast"; broadcastId: string } | { kind: "sequence"; sequenceId: string; stepId: string };

const REF_PART_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function broadcastTrackingId(broadcastId: string): string {
  return `broadcast:${broadcastId}`;
}

export function sequenceTrackingId(sequenceId: string, stepId: string): string {
  return `sequence:${sequenceId}:${stepId}`;
}

export function parseTrackingId(value: string | null | undefined): TrackingRef | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const parts = value.split(":");
  if (parts.slice(1).some((p) => !REF_PART_RE.test(p))) return null;
  if (parts[0] === "broadcast" && parts.length === 2) return { kind: "broadcast", broadcastId: parts[1]! };
  if (parts[0] === "sequence" && parts.length === 3) return { kind: "sequence", sequenceId: parts[1]!, stepId: parts[2]! };
  return null;
}

/** A tracking id worth storing on an outbox row (known format), or undefined. */
export function normalizeTrackingId(value: string | null | undefined): string | undefined {
  return parseTrackingId(value) ? value! : undefined;
}

/**
 * Whether a tracking id belongs to `campaign`: the id itself, or a whole
 * sequence when `campaign` is "sequence:<id>" (which covers every step).
 */
export function belongsToCampaign(trackingId: string | null | undefined, campaign: string): boolean {
  return !!trackingId && !!campaign && (trackingId === campaign || trackingId.startsWith(`${campaign}:`));
}

/* ------------------------------------------------------------------ */
/* Recording rules                                                     */
/* ------------------------------------------------------------------ */

export const TRACKING_RULES = {
  /** Events stored per email at most (repeat opens and clicks beyond this are ignored). */
  maxEventsPerEmail: 50,
  /** A repeat open is only stored when the last one is older than this. */
  reopenGapMs: 60 * 60_000,
  /** A repeat click on the same link is only stored when the last one is older than this. */
  reclickGapMs: 60_000,
} as const;

export type TrackingHit = { type: "open" } | { type: "click"; url: string };

export interface TrackingPlan {
  add: { type: "open" | "click"; url?: string }[];
  /** The email had no open before (counts towards unique opens). */
  firstOpen: boolean;
  /** The email had no click before (counts towards unique clicks). */
  firstClick: boolean;
}

/** What may be recorded right now (the global tracking switches). */
export interface TrackingAllowance {
  opens: boolean;
  clicks: boolean;
}

/**
 * Which events to store for a hit, given the email's existing events. A click
 * also proves the email was opened (images are often blocked), so the first
 * click records an open when there is none yet. Nothing is planned for a kind
 * of event that `allow` switches off — emails sent while tracking was on keep
 * their pixel and redirects, but stop recording once it is turned off.
 */
export function planTrackingEvents(
  existing: readonly Pick<EmailEvent, "type" | "url" | "createdAt">[],
  hit: TrackingHit,
  now: number = Date.now(),
  allow: TrackingAllowance = { opens: true, clicks: true },
): TrackingPlan {
  const plan: TrackingPlan = { add: [], firstOpen: false, firstClick: false };
  if (existing.length >= TRACKING_RULES.maxEventsPerEmail) return plan;
  const opens = existing.filter((e) => e.type === "open");
  const latest = (rows: readonly Pick<EmailEvent, "createdAt">[]) => rows.reduce((max, e) => Math.max(max, Date.parse(e.createdAt) || 0), 0);

  if (hit.type === "open") {
    if (!allow.opens) return plan;
    if (opens.length && now - latest(opens) < TRACKING_RULES.reopenGapMs) return plan;
    plan.add.push({ type: "open" });
    plan.firstOpen = opens.length === 0;
    return plan;
  }

  if (!allow.clicks) return plan;
  const clicks = existing.filter((e) => e.type === "click");
  const sameLink = clicks.filter((e) => e.url === hit.url);
  if (!opens.length && allow.opens) {
    plan.add.push({ type: "open" });
    plan.firstOpen = true;
  }
  if (!sameLink.length || now - latest(sameLink) >= TRACKING_RULES.reclickGapMs) {
    plan.add.push({ type: "click", url: hit.url });
    plan.firstClick = clicks.length === 0;
  }
  return plan;
}

/**
 * Events worth keeping once outbox rows have been deleted (old sent messages
 * are cleaned up, accounts get erased): an event stays while its email still
 * exists, or while the campaign it was recorded for does — by then it is an
 * anonymous count. Returns the same array when nothing has to go.
 */
export function retainedEvents<E extends Pick<EmailEvent, "emailId" | "trackingId">>(
  events: readonly E[],
  emailExists: (emailId: string) => boolean,
  campaignExists: (ref: TrackingRef) => boolean,
): readonly E[] {
  const campaigns = new Map<string, boolean>();
  const alive = (trackingId: string | undefined): boolean => {
    if (!trackingId) return false;
    let known = campaigns.get(trackingId);
    if (known === undefined) {
      const ref = parseTrackingId(trackingId);
      known = !!ref && campaignExists(ref);
      campaigns.set(trackingId, known);
    }
    return known;
  };
  const kept = events.filter((e) => emailExists(e.emailId) || alive(e.trackingId));
  return kept.length === events.length ? events : kept;
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export interface LinkStats {
  url: string;
  clicks: number;
  /** Distinct emails that clicked the link. */
  uniqueClicks: number;
}

export interface EventSummary {
  totalOpens: number;
  /** Distinct emails opened. */
  uniqueOpens: number;
  totalClicks: number;
  /** Distinct emails with at least one click. */
  uniqueClicks: number;
  /** Most clicked first. */
  links: LinkStats[];
}

/** Totals and per-link counts for a set of events (pass only the events of the emails you report on). */
export function summarizeEvents(events: readonly Pick<EmailEvent, "emailId" | "type" | "url">[]): EventSummary {
  const opened = new Set<string>();
  const clicked = new Set<string>();
  const links = new Map<string, { clicks: number; emails: Set<string> }>();
  let totalOpens = 0;
  let totalClicks = 0;
  for (const e of events) {
    if (e.type === "open") {
      totalOpens++;
      opened.add(e.emailId);
    } else if (e.type === "click") {
      totalClicks++;
      clicked.add(e.emailId);
      if (e.url) {
        const row = links.get(e.url) ?? { clicks: 0, emails: new Set<string>() };
        row.clicks++;
        row.emails.add(e.emailId);
        links.set(e.url, row);
      }
    }
  }
  return {
    totalOpens,
    uniqueOpens: opened.size,
    totalClicks,
    uniqueClicks: clicked.size,
    links: [...links]
      .map(([url, row]) => ({ url, clicks: row.clicks, uniqueClicks: row.emails.size }))
      .sort((a, b) => b.uniqueClicks - a.uniqueClicks || b.clicks - a.clicks || a.url.localeCompare(b.url)),
  };
}

/** Percentage with one decimal (0 when there is nothing to divide by). */
export function ratePercent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((Math.min(part, whole) / whole) * 1000) / 10;
}
