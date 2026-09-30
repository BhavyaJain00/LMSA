import type { Affiliate, Commission, Payment } from "@/lib/types";

/**
 * Affiliate programme rules shared by the proxy, the server and client UI.
 * Pure: no Node, Next or store imports, so it is safe everywhere (including
 * `src/proxy.ts`) and unit tested directly.
 *
 * Attribution is last-click: `?ref=CODE` on any page stores `CODE.<unix
 * seconds>` in the `ll_ref` cookie (a later link overwrites it), and a sale
 * is credited when the click is at most `settings.growth.cookieDays` old.
 * The window is checked on the server from the stored click time, so the
 * cookie itself can outlive a shorter window safely.
 */

export const REF_COOKIE = "ll_ref";
/** Query parameter carrying the affiliate code on share links. */
export const REF_PARAM = "ref";
/**
 * Request header the proxy adds on the request that carried `?ref=`, holding
 * the landing path, so the page render can record the click once.
 */
export const REF_CLICK_HEADER = "x-ll-referral";
/** Longest attribution window an administrator can choose. */
export const MAX_COOKIE_DAYS = 365;
/** The cookie lives as long as the longest window; shorter windows are enforced on the server. */
export const REF_COOKIE_MAX_AGE = MAX_COOKIE_DAYS * 24 * 60 * 60;
/** Repeat visits by the same visitor through the same affiliate inside this span count as one click. */
export const CLICK_DEDUPE_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/* ------------------------------------------------------------------ */
/* Codes and the referral cookie                                       */
/* ------------------------------------------------------------------ */

/** Upper-cased code when `raw` is a well-formed affiliate code (3–32 of A–Z, 0–9, `_`, `-`), else null. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** A code suggestion derived from a username or name, e.g. "ada-lovelace" → "ADALOVELACE". */
export function codeFromName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  return base.length >= 3 ? base : `REF${base}`;
}

/**
 * First free code for `name`: the plain suggestion, then with 2-digit
 * suffixes. `random` (0–1) makes the suffix sequence testable.
 */
export function uniqueCode(name: string, taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(Array.from(taken, (c) => c.toUpperCase()));
  const base = codeFromName(name);
  if (!used.has(base)) return base;
  for (let i = 0; i < 200; i++) {
    const candidate = `${base}${Math.floor(10 + random() * 990)}`;
    if (!used.has(candidate)) return candidate;
  }
  let n = 1000;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export interface RefCookie {
  code: string;
  /** Click time, epoch milliseconds. */
  at: number;
}

/** Cookie value for a click on `code` at `atMs`. */
export function formatRefCookie(code: string, atMs: number): string {
  return `${code}.${Math.floor(atMs / 1000)}`;
}

/** Parse the `ll_ref` cookie; null for anything malformed or dated in the future. */
export function parseRefCookie(value: string | undefined | null, nowMs: number = Date.now()): RefCookie | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const code = normalizeCode(value.slice(0, dot));
  const seconds = Number(value.slice(dot + 1));
  if (!code || !Number.isInteger(seconds) || seconds <= 0) return null;
  const at = seconds * 1000;
  // Allow a little clock skew between the proxy and this server.
  if (at > nowMs + 5 * 60 * 1000) return null;
  return { code, at };
}

/** Attribution window in whole days, clamped to 1–365. */
export function clampCookieDays(days: unknown): number {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_COOKIE_DAYS, Math.max(1, n));
}

/** Whether a click at `clickMs` still attributes an action at `nowMs`. */
export function withinWindow(clickMs: number, nowMs: number, cookieDays: number): boolean {
  if (!Number.isFinite(clickMs) || clickMs > nowMs + 5 * 60 * 1000) return false;
  return nowMs - clickMs <= clampCookieDays(cookieDays) * DAY_MS;
}

/**
 * Last-click attribution: among the clicks that are inside the window at
 * `nowMs` (and not after it), the most recent one wins.
 */
export function pickLastClick<T extends { at: number }>(clicks: readonly T[], nowMs: number, cookieDays: number): T | null {
  let best: T | null = null;
  for (const click of clicks) {
    if (click.at > nowMs + 5 * 60 * 1000 || !withinWindow(click.at, nowMs, cookieDays)) continue;
    if (!best || click.at > best.at) best = click;
  }
  return best;
}

/** Landing path recorded for a click: path only, bounded, and never a protocol-relative URL. */
export function sanitizeLandingPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  const clean = path.replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.length > 300 ? clean.slice(0, 300) : clean;
}

/** A group of pages offered in the share-link builder. */
export interface ShareTargetGroup {
  label: string;
  items: { label: string; path: string }[];
}

/** Share link: `path` on `origin` with `?ref=CODE` (existing query kept, an older ref replaced). */
export function shareUrl(origin: string, path: string, code: string): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  url.searchParams.set(REF_PARAM, code);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Commission math                                                     */
/* ------------------------------------------------------------------ */

/** Commission percent, clamped to 0–100 with at most two decimals. */
export function clampPercent(value: unknown, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

/** Net, tax-exclusive amount of an order: what the buyer paid minus the tax in it. */
export function commissionBase(payment: Pick<Payment, "amount" | "taxAmount">): number {
  return Math.max(0, Math.round(payment.amount) - Math.max(0, Math.round(payment.taxAmount || 0)));
}

/** Commission on `base` (smallest currency unit) at `percent`, rounded to the nearest unit. */
export function computeCommission(base: number, percent: number): number {
  if (!(base > 0)) return 0;
  return Math.round((base * clampPercent(percent, 0)) / 100);
}

export type CommissionIneligibility = "disabled" | "no_affiliate" | "inactive" | "self_referral" | "zero_amount" | "exists";

/** Why an order earns no commission, or null when it does. */
export function commissionIneligibility(input: {
  enabled: boolean;
  affiliate: Pick<Affiliate, "userId" | "status"> | null | undefined;
  buyerId: string;
  base: number;
  percent: number;
  alreadyCredited: boolean;
}): CommissionIneligibility | null {
  if (!input.enabled) return "disabled";
  if (!input.affiliate) return "no_affiliate";
  if (input.affiliate.status !== "active") return "inactive";
  if (input.affiliate.userId === input.buyerId) return "self_referral";
  if (input.alreadyCredited) return "exists";
  if (computeCommission(input.base, input.percent) <= 0) return "zero_amount";
  return null;
}

type CommissionLike = Pick<Commission, "id" | "amount" | "status" | "createdAt">;

export interface RefundPlan {
  /** Rows to void (none of them paid). */
  voidIds: string[];
  /** Negative correction row to add, when the commission cannot simply be voided. */
  adjustment: { amount: number; status: "pending" | "approved" } | null;
}

/**
 * How the commission rows of one order change after a refund.
 *
 * The first positive row is the original commission and is never edited, so
 * the target is always derived from it: `original × (amount − refunded) /
 * amount`, and 0 for a full refund. When nothing has been paid out yet and
 * the target is 0, every live row is voided; otherwise a negative row makes
 * up the difference — with the original's status while unpaid, or approved
 * (deducted from the next payout) once money went out. Idempotent: applying
 * the plan and planning again yields no change.
 */
export function planRefund(rows: readonly CommissionLike[], order: { amount: number; refundedAmount: number; full: boolean }): RefundPlan {
  const none: RefundPlan = { voidIds: [], adjustment: null };
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const original = sorted.find((r) => r.amount > 0);
  if (!original || original.status === "void") return none;
  const live = sorted.filter((r) => r.status !== "void");
  const current = live.reduce((s, r) => s + r.amount, 0);
  const refunded = Math.min(Math.max(0, order.refundedAmount), order.amount);
  const remaining = order.full || order.amount <= 0 ? 0 : (order.amount - refunded) / order.amount;
  const target = Math.round(original.amount * remaining);
  if (target >= current) return none;
  const anyPaid = live.some((r) => r.status === "paid");
  if (!anyPaid && target === 0) return { voidIds: live.map((r) => r.id), adjustment: null };
  const status = anyPaid ? "approved" : original.status === "approved" ? "approved" : "pending";
  return { voidIds: [], adjustment: { amount: target - current, status } };
}

/** How an affiliate payout was sent. */
export const PAYOUT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "paypal", label: "PayPal" },
  { value: "wise", label: "Wise" },
  { value: "upi", label: "UPI" },
  { value: "store_credit", label: "Store credit" },
  { value: "other", label: "Other" },
] as const;

export function methodLabel(method: string): string {
  return PAYOUT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

export interface CurrencyTotals {
  currency: string;
  pending: number;
  approved: number;
  paid: number;
  voided: number;
}

/** Commission totals per currency (negative adjustment rows net into their status). */
export function commissionTotals(rows: readonly Pick<Commission, "amount" | "currency" | "status">[]): CurrencyTotals[] {
  const by = new Map<string, CurrencyTotals>();
  for (const r of rows) {
    const t = by.get(r.currency) ?? { currency: r.currency, pending: 0, approved: 0, paid: 0, voided: 0 };
    if (r.status === "pending") t.pending += r.amount;
    else if (r.status === "approved") t.approved += r.amount;
    else if (r.status === "paid") t.paid += r.amount;
    else t.voided += r.amount;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Approved, unpaid balance per currency (what the next payout would send). */
export function payableBalances(rows: readonly Pick<Commission, "amount" | "currency" | "status">[]): { currency: string; amount: number }[] {
  return commissionTotals(rows)
    .filter((t) => t.approved !== 0)
    .map((t) => ({ currency: t.currency, amount: t.approved }));
}

/** Share of `part` in `total` as a percentage with one decimal (0 when total is 0). */
export function rate(part: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/* ------------------------------------------------------------------ */
/* Fraud signals                                                       */
/* ------------------------------------------------------------------ */

export type FraudFlag = "shared_ip" | "same_email";

export const FRAUD_FLAG_LABELS: Record<FraudFlag, string> = {
  shared_ip: "Same IP as affiliate",
  same_email: "Buyer email matches affiliate",
};

/**
 * Canonical mailbox for comparing addresses: lower-cased, `+tags` removed,
 * and for Gmail the dots in the local part too (they all reach one inbox).
 */
export function canonicalEmail(email: string | undefined | null): string {
  if (!email) return "";
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/**
 * Signals that the buyer may be the affiliate (self-referral under another
 * account): they signed in from a common IP address, or the buyer's email
 * is the affiliate's account or payout mailbox.
 */
export function fraudFlags(input: {
  buyerEmail?: string;
  buyerIps: Iterable<string>;
  affiliateEmails: (string | undefined)[];
  affiliateIps: ReadonlySet<string>;
}): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const ip of input.buyerIps) {
    if (ip && ip !== "unknown" && input.affiliateIps.has(ip)) {
      flags.push("shared_ip");
      break;
    }
  }
  const buyer = canonicalEmail(input.buyerEmail);
  if (buyer && input.affiliateEmails.some((e) => canonicalEmail(e) === buyer)) flags.push("same_email");
  return flags;
}

/** One commission as listed to administrators (flattened with its order, buyer and affiliate). */
export interface CommissionRowView {
  id: string;
  status: Commission["status"];
  /** Negative for a refund correction. */
  amount: number;
  currency: string;
  createdAt: string;
  paidAt?: string;
  affiliateId: string;
  affiliateCode: string;
  affiliateName: string;
  orderId: string;
  itemTitle: string;
  buyerName: string;
  buyerEmail: string;
  orderAmount: number;
  flags: FraudFlag[];
}

/* ------------------------------------------------------------------ */
/* Admin list filters (URL search params)                              */
/* ------------------------------------------------------------------ */

export type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams;

/** First value of a query parameter ("" when missing). */
export function param(sp: SearchParamsLike, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 1-based `page` query parameter. */
export function pageParam(sp: SearchParamsLike): number {
  const page = Number.parseInt(param(sp, "page"), 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export const AFFILIATE_STATUSES = ["pending", "active", "paused"] as const;
export const COMMISSION_STATUSES = ["pending", "approved", "paid", "void"] as const;

export interface AffiliateFilter {
  status: Affiliate["status"] | "all";
  q: string;
  /** Only affiliates with at least one flagged, unpaid commission. */
  flagged: boolean;
  page: number;
}

export interface CommissionFilter {
  status: Commission["status"] | "all";
  affiliateId: string;
  q: string;
  flagged: boolean;
  /** Inclusive YYYY-MM-DD bounds on the commission date. */
  from: string;
  to: string;
  page: number;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAffiliateFilter(sp: SearchParamsLike): AffiliateFilter {
  const status = param(sp, "status");
  return {
    status: (AFFILIATE_STATUSES as readonly string[]).includes(status) ? (status as Affiliate["status"]) : "all",
    q: param(sp, "q").trim().slice(0, 120),
    flagged: param(sp, "flagged") === "1",
    page: pageParam(sp),
  };
}

export function parseCommissionFilter(sp: SearchParamsLike): CommissionFilter {
  const status = param(sp, "status");
  const from = param(sp, "from");
  const to = param(sp, "to");
  return {
    status: (COMMISSION_STATUSES as readonly string[]).includes(status) ? (status as Commission["status"]) : "all",
    affiliateId: /^[A-Za-z0-9_-]{1,64}$/.test(param(sp, "affiliate")) ? param(sp, "affiliate") : "",
    q: param(sp, "q").trim().slice(0, 120),
    flagged: param(sp, "flagged") === "1",
    from: DAY_KEY.test(from) ? from : "",
    to: DAY_KEY.test(to) ? to : "",
    page: pageParam(sp),
  };
}

/** Ids sent by a bulk action: 1 to `max` well-formed ids without duplicates, or null when the input is not that. */
export function cleanIdList(input: unknown, max: number): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > max) return null;
  const ids = input.filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v));
  return ids.length === input.length ? Array.from(new Set(ids)) : null;
}

/** Slice of `rows` for a 1-based `page` (clamped to the last page). */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { rows: T[]; page: number; pageCount: number; total: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount, total: rows.length };
}
