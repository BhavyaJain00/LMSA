/**
 * First-party analytics rules shared by the page-view beacon, `/api/analytics`,
 * the server-side event recorder and `/admin/analytics` (growth area). Pure
 * and isomorphic: no store, no request APIs.
 *
 * Privacy model:
 *  - Visitors who declined analytics cookies (or send Do-Not-Track / Global
 *    Privacy Control) are counted anonymously or not at all: their page views
 *    carry no visitor id and no member id, only the path, the referring site
 *    and campaign tags.
 *  - Paths are reduced to their route shape where they could carry a secret
 *    (seat invitations, tokens) and query strings are never stored.
 *  - Referrers are reduced to the host name.
 *  - Raw events are kept for `RETENTION_DAYS`, then folded into daily
 *    rollups without any visitor id.
 */

export const PAGE_VIEW = "page_view";
export const CHECKOUT_STARTED = "checkout_started";
export const PURCHASE = "purchase";
export const SIGN_UP = "sign_up";
export const ENROLL = "enroll";
export const LEAD = "lead";

/** Every event name the analytics pipeline records. */
export const TRACKED_EVENTS = [PAGE_VIEW, CHECKOUT_STARTED, PURCHASE, SIGN_UP, ENROLL, LEAD] as const;
export type TrackedEventName = (typeof TRACKED_EVENTS)[number];

/** `itemType` of the page view that started a visit (landing page). */
export const ENTRY_MARK = "entry";
/** Rollup rows: `rollup:<event>` holds a count in `value`; `rollup-sum:<event>` holds the summed `value`. */
export const ROLLUP_COUNT_PREFIX = "rollup:";
export const ROLLUP_SUM_PREFIX = "rollup-sum:";
/** Daily unique visitors of a compacted day. */
export const VISITORS_ROLLUP = `${ROLLUP_COUNT_PREFIX}visitors`;

/** Raw events older than this are folded into daily rollups. */
export const RETENTION_DAYS = 90;
/** A sign-up or purchase is credited to the last campaign/referrer touch within this many days. */
export const ATTRIBUTION_DAYS = 30;
/** Longest range the dashboard accepts. */
export const MAX_RANGE_DAYS = 731;
export const RANGE_PRESETS = [7, 30, 90, 365] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PATH = 300;
const MAX_UTM = 80;
const MAX_HOST = 120;

/* ------------------------------------------------------------------ */
/* Beacon payload                                                       */
/* ------------------------------------------------------------------ */

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}

/** What the browser sends to `/api/analytics` (all fields untrusted). */
export interface BeaconPayload {
  path: string;
  /** Full `document.referrer` of a visit's first page; reduced to a host on the server. */
  referrer?: string;
  utm?: Utm;
  /** First page view of a visit (full page load from another site or typed in). */
  entry: boolean;
  /** The browser's analytics-consent decision; ids are stored only when this and the consent cookie agree. */
  consent: boolean;
  /** First page of this browser tab at its funnel stage (see `funnelStageOf`); counts anonymous visits once per stage. */
  firstReach?: boolean;
}

const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;

/** True for a path segment that looks like a random secret (mixed case and digits, 20+ chars). */
function looksLikeToken(segment: string): boolean {
  return TOKEN_SEGMENT.test(segment) && /[A-Z]/.test(segment) && /[a-z]/.test(segment) && /\d/.test(segment);
}

/**
 * The path stored for a page view: no query or hash, no secrets.
 * `/join/<token>` becomes `/join/[token]`, order pages become
 * `/billing/success/[order]`, and any token-like segment becomes `[token]`.
 * Null for anything that is not a same-site absolute path.
 */
export function sanitizeTrackedPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.split(/[?#]/, 1)[0]!.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(path)) return null;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  const segments = path.split("/").slice(1);
  if (segments[0] === "join" && segments.length > 1) return "/join/[token]";
  if (segments[0] === "billing" && (segments[1] === "success" || segments[1] === "invoice") && segments.length > 2) return `/billing/${segments[1]}/[order]`;
  const masked = "/" + segments.map((s) => (looksLikeToken(s) ? "[token]" : s)).join("/");
  return masked.length > MAX_PATH ? masked.slice(0, MAX_PATH) : masked;
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * The referring site's host name (lowercase, without `www.`), or undefined
 * for no referrer, a non-web referrer, or this site itself.
 */
export function referrerHost(raw: unknown, ownHost: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = stripWww(url.hostname.toLowerCase());
  if (!host || host.length > MAX_HOST) return undefined;
  const own = ownHost ? stripWww(ownHost.toLowerCase().replace(/:\d+$/, "")) : "";
  if (own && host === own) return undefined;
  return host;
}

function cleanUtmValue(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .toLowerCase()
    .slice(0, MAX_UTM);
  return value || undefined;
}

/** Campaign tags from `utm_source` / `utm_medium` / `utm_campaign` (or an object with those keys); undefined when none. */
export function normalizeUtm(input: unknown): Utm | undefined {
  if (!input || typeof input !== "object") return undefined;
  const get = (key: "source" | "medium" | "campaign"): unknown =>
    input instanceof URLSearchParams ? input.get(`utm_${key}`) : (input as Record<string, unknown>)[key] ?? (input as Record<string, unknown>)[`utm_${key}`];
  const utm: Utm = {};
  const source = cleanUtmValue(get("source"));
  const medium = cleanUtmValue(get("medium"));
  const campaign = cleanUtmValue(get("campaign"));
  if (source) utm.source = source;
  if (medium) utm.medium = medium;
  if (campaign) utm.campaign = campaign;
  return source || medium || campaign ? utm : undefined;
}

/** Validate a beacon body; null when it is not a usable page view. */
export function parseBeaconPayload(body: unknown): BeaconPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const path = sanitizeTrackedPath(b.path);
  if (!path) return null;
  const payload: BeaconPayload = { path, entry: b.entry === true, consent: b.consent === true };
  if (typeof b.referrer === "string" && b.referrer.length <= 2048) payload.referrer = b.referrer;
  const utm = normalizeUtm(b.utm);
  if (utm) payload.utm = utm;
  if (b.firstReach === true && funnelStageOf(path)) payload.firstReach = true;
  return payload;
}

/** Do-Not-Track or Global Privacy Control sent by the browser. */
export function optedOut(headers: Pick<Headers, "get">): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

/* ------------------------------------------------------------------ */
/* Path classification (funnel stages)                                  */
/* ------------------------------------------------------------------ */

const COURSE_LIST_SEGMENTS = new Set(["category", "tag"]);
const BILLING_PAGES = new Set(["success", "invoice", "history", "cancelled"]);

/** Slug of a course sales page (`/courses/<slug>`), or null. */
export function coursePageSlug(path: string): string | null {
  const m = /^\/courses\/([^/]+)$/.exec(path);
  return m && !COURSE_LIST_SEGMENTS.has(m[1]!) ? m[1]! : null;
}

/** True for a page that sells something: a course, bundle or the membership pricing page. */
export function isProductPage(path: string): boolean {
  return coursePageSlug(path) !== null || /^\/bundles\/[^/]+$/.test(path) || path === "/pricing";
}

/** The item of a checkout page (`/billing/<type>/<id>`), or null. */
export function checkoutTarget(path: string): { itemType: string; itemId: string } | null {
  const m = /^\/billing\/([a-z]+)\/([^/]+)$/.exec(path);
  if (!m || BILLING_PAGES.has(m[1]!)) return null;
  return { itemType: m[1]!, itemId: m[2]! };
}

/** The funnel stage a page belongs to past the visit itself: a checkout or a product page. */
export function funnelStageOf(path: string): "checkout" | "product" | null {
  if (checkoutTarget(path)) return "checkout";
  return isProductPage(path) ? "product" : null;
}

/* ------------------------------------------------------------------ */
/* Date ranges (UTC days)                                               */
/* ------------------------------------------------------------------ */

export interface DateRange {
  /** First day, YYYY-MM-DD (UTC), inclusive. */
  from: string;
  /** Last day, YYYY-MM-DD (UTC), inclusive. */
  to: string;
  days: number;
  preset: RangePreset | null;
}

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight UTC of a YYYY-MM-DD key; NaN for an invalid key. */
export function dayStartMs(key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return Number.NaN;
  const ms = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isFinite(ms) && utcDayKey(ms) === key ? ms : Number.NaN;
}

/** Range of `days` days ending today. */
export function presetRange(days: number, nowMs: number): DateRange {
  const toMs = dayStartMs(utcDayKey(nowMs));
  const preset = (RANGE_PRESETS as readonly number[]).includes(days) ? (days as RangePreset) : null;
  return { from: utcDayKey(toMs - (days - 1) * DAY_MS), to: utcDayKey(toMs), days, preset };
}

type ParamSource = Record<string, string | string[] | undefined> | URLSearchParams;

function readParam(sp: ParamSource, key: string): string {
  const raw = sp instanceof URLSearchParams ? sp.get(key) : sp[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The range in `?range=7|30|90|365` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (custom wins). Days in the future are cut off, a reversed range is
 * swapped and spans are capped at `MAX_RANGE_DAYS`. Defaults to 30 days.
 */
export function parseRange(sp: ParamSource, nowMs: number = Date.now()): DateRange {
  const todayMs = dayStartMs(utcDayKey(nowMs));
  let fromMs = dayStartMs(readParam(sp, "from"));
  let toMs = dayStartMs(readParam(sp, "to"));
  if (Number.isFinite(fromMs) || Number.isFinite(toMs)) {
    if (!Number.isFinite(toMs)) toMs = todayMs;
    if (!Number.isFinite(fromMs)) fromMs = toMs - 29 * DAY_MS;
    if (fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];
    toMs = Math.min(toMs, todayMs);
    fromMs = Math.min(fromMs, toMs);
    fromMs = Math.max(fromMs, toMs - (MAX_RANGE_DAYS - 1) * DAY_MS);
    const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
    return { from: utcDayKey(fromMs), to: utcDayKey(toMs), days, preset: null };
  }
  const preset = Number(readParam(sp, "range"));
  return presetRange((RANGE_PRESETS as readonly number[]).includes(preset) ? preset : 30, nowMs);
}

/** The period of the same length right before `range` (for trends). */
export function previousRange(range: DateRange): DateRange {
  const fromMs = dayStartMs(range.from);
  return { from: utcDayKey(fromMs - range.days * DAY_MS), to: utcDayKey(fromMs - DAY_MS), days: range.days, preset: range.preset };
}

/** Start (inclusive) and end (exclusive) of the range in epoch ms. */
export function rangeBounds(range: DateRange): { startMs: number; endMs: number } {
  return { startMs: dayStartMs(range.from), endMs: dayStartMs(range.to) + DAY_MS };
}

export function inRange(iso: string | undefined, bounds: { startMs: number; endMs: number }): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return ms >= bounds.startMs && ms < bounds.endMs;
}

/** Every day of the range, oldest first. */
export function dayKeys(range: DateRange): string[] {
  const start = dayStartMs(range.from);
  return Array.from({ length: range.days }, (_, i) => utcDayKey(start + i * DAY_MS));
}

/** Query string of a range, for links and exports. */
export function rangeQuery(range: DateRange): string {
  return range.preset ? `range=${range.preset}` : `from=${range.from}&to=${range.to}`;
}

/** Percent change from `previous` to `current`, one decimal; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** `part` as a percentage of `total` with one decimal (0 when total is 0). */
export function ratio(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
