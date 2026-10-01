import type { AnalyticsEvent, MembershipPlan, Payment, Subscription } from "@/lib/types";
import {
  ATTRIBUTION_DAYS,
  CHECKOUT_STARTED,
  DAY_MS,
  ENTRY_MARK,
  PAGE_VIEW,
  PURCHASE,
  ROLLUP_COUNT_PREFIX,
  ROLLUP_SUM_PREFIX,
  SIGN_UP,
  VISITORS_ROLLUP,
  coursePageSlug,
  inRange,
  isProductPage,
  ratio,
  utcDayKey,
  type Utm,
} from "./analytics-shared";

/**
 * Pure analytics computations (growth area): event normalization, campaign
 * attribution, rollups, funnel, revenue, MRR and cohort retention. The
 * server module (`analytics.ts`) feeds them slices of the store.
 */

type Bounds = { startMs: number; endMs: number };

/* ------------------------------------------------------------------ */
/* Raw events and rollups                                               */
/* ------------------------------------------------------------------ */

export function isRollup(e: Pick<AnalyticsEvent, "name">): boolean {
  return e.name.startsWith(ROLLUP_COUNT_PREFIX) || e.name.startsWith(ROLLUP_SUM_PREFIX);
}

/** One event (raw or rolled up) seen as a weighted count. */
export interface EventCount {
  name: string;
  at: string;
  path?: string;
  referrer?: string;
  utm?: Utm;
  itemType?: string;
  itemId?: string;
  currency?: string;
  /** How many events this row stands for. */
  count: number;
  /** Sum of the events' `value`. */
  sum: number;
  /** Visitor or member key of a raw event recorded with consent (or server-side). */
  actor?: string;
  userId?: string;
  raw: boolean;
}

/** Visitor key: the anonymous visitor id when present (it survives signing in), else the member. */
export function actorKey(e: Pick<AnalyticsEvent, "anonId" | "userId">): string | undefined {
  if (e.anonId) return `a:${e.anonId}`;
  if (e.userId) return `u:${e.userId}`;
  return undefined;
}

export function toEventCount(e: AnalyticsEvent): EventCount {
  const base = { at: e.createdAt, path: e.path, referrer: e.referrer, utm: e.utm, itemType: e.itemType, itemId: e.itemId, currency: e.currency };
  if (e.name.startsWith(ROLLUP_SUM_PREFIX)) return { ...base, name: e.name.slice(ROLLUP_SUM_PREFIX.length), count: 0, sum: e.value ?? 0, raw: false };
  if (e.name.startsWith(ROLLUP_COUNT_PREFIX)) return { ...base, name: e.name.slice(ROLLUP_COUNT_PREFIX.length), count: e.value ?? 0, sum: 0, raw: false };
  return { ...base, name: e.name, count: 1, sum: e.value ?? 0, actor: actorKey(e), userId: e.userId, raw: true };
}

function sameUtm(a: Utm | undefined, b: Utm | undefined): boolean {
  return (a?.source ?? "") === (b?.source ?? "") && (a?.medium ?? "") === (b?.medium ?? "") && (a?.campaign ?? "") === (b?.campaign ?? "");
}

/**
 * Credit sign-ups and purchases that carry no campaign data to the member's
 * last visit with a referrer or campaign tags in the `ATTRIBUTION_DAYS`
 * before. A member's visits are the page views recorded with their member id
 * and those of any visitor id that was ever seen together with it. Returns
 * a map of event id → touch; events already attributed are skipped.
 */
export function attributeConversions(events: readonly AnalyticsEvent[]): Map<string, { referrer?: string; utm?: Utm }> {
  const anonsByUser = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.userId || !e.anonId) continue;
    let set = anonsByUser.get(e.userId);
    if (!set) anonsByUser.set(e.userId, (set = new Set()));
    set.add(e.anonId);
  }
  const touchesByUser = new Map<string, AnalyticsEvent[]>();
  const touchesByAnon = new Map<string, AnalyticsEvent[]>();
  for (const e of events) {
    if (e.name !== PAGE_VIEW || e.itemType !== ENTRY_MARK || (!e.referrer && !e.utm)) continue;
    if (e.userId) (touchesByUser.get(e.userId) ?? touchesByUser.set(e.userId, []).get(e.userId)!).push(e);
    if (e.anonId) (touchesByAnon.get(e.anonId) ?? touchesByAnon.set(e.anonId, []).get(e.anonId)!).push(e);
  }
  const out = new Map<string, { referrer?: string; utm?: Utm }>();
  for (const e of events) {
    if ((e.name !== SIGN_UP && e.name !== PURCHASE) || !e.userId || e.referrer || e.utm) continue;
    const at = Date.parse(e.createdAt);
    const candidates = [...(touchesByUser.get(e.userId) ?? [])];
    for (const anon of anonsByUser.get(e.userId) ?? []) candidates.push(...(touchesByAnon.get(anon) ?? []));
    let best: AnalyticsEvent | null = null;
    let bestAt = -Infinity;
    for (const t of candidates) {
      const tAt = Date.parse(t.createdAt);
      if (tAt > at || tAt < at - ATTRIBUTION_DAYS * DAY_MS || tAt <= bestAt) continue;
      best = t;
      bestAt = tAt;
    }
    if (best) out.set(e.id, { referrer: best.referrer, utm: best.utm });
  }
  return out;
}

/** Copy of `events` with the attribution of `attributeConversions` applied. */
export function withAttribution(events: readonly AnalyticsEvent[]): AnalyticsEvent[] {
  const touches = attributeConversions(events);
  if (!touches.size) return [...events];
  return events.map((e) => {
    const t = touches.get(e.id);
    if (!t) return e;
    const next: AnalyticsEvent = { ...e };
    if (t.referrer) next.referrer = t.referrer;
    if (t.utm) next.utm = { ...t.utm };
    return next;
  });
}

function rollupKey(name: string, day: string, e: Pick<AnalyticsEvent, "path" | "referrer" | "utm" | "itemType" | "itemId" | "currency">): string {
  return [name, day, e.path ?? "", e.referrer ?? "", e.utm?.source ?? "", e.utm?.medium ?? "", e.utm?.campaign ?? "", e.itemType ?? "", e.itemId ?? "", e.currency ?? ""].join("\u0001");
}

/**
 * Fold raw events into daily rollups (no visitor or member ids): one
 * `rollup:<name>` row per day and dimension set with the count, a
 * `rollup-sum:<name>` row when the events carried values, one
 * `rollup:visitors` row per day with that day's unique visitors (visitors
 * recorded with consent, plus visits recorded without), and one
 * `rollup:reach:<stage>` row per day and funnel stage with the people who
 * reached it (counted the same way), so the funnel reads the same after
 * compaction. Rows that match an
 * existing rollup are added to it. Returns the rows to keep (existing ones
 * updated in place on a copy, new ones appended).
 */
export function buildRollups(raw: readonly AnalyticsEvent[], existing: readonly AnalyticsEvent[], newId: () => string): AnalyticsEvent[] {
  const rows = existing.map((r) => ({ ...r }));
  const index = new Map<string, AnalyticsEvent>();
  for (const r of rows) index.set(rollupKey(r.name, r.createdAt.slice(0, 10), r), r);
  const add = (name: string, day: string, dims: Pick<AnalyticsEvent, "path" | "referrer" | "utm" | "itemType" | "itemId" | "currency">, value: number) => {
    const key = rollupKey(name, day, dims);
    const found = index.get(key);
    if (found) {
      found.value = (found.value ?? 0) + value;
      return;
    }
    const row: AnalyticsEvent = { id: newId(), name, createdAt: `${day}T00:00:00.000Z`, value };
    if (dims.path) row.path = dims.path;
    if (dims.referrer) row.referrer = dims.referrer;
    if (dims.utm) row.utm = { ...dims.utm };
    if (dims.itemType) row.itemType = dims.itemType;
    if (dims.itemId) row.itemId = dims.itemId;
    if (dims.currency) row.currency = dims.currency;
    rows.push(row);
    index.set(key, row);
  };

  const visitors = new Map<string, { actors: Set<string>; anonymousVisits: number }>();
  const reached = new Map<string, { actors: Set<string>; anonymous: number }>();
  for (const e of raw) {
    if (isRollup(e)) continue;
    const day = e.createdAt.slice(0, 10);
    const dims = { path: e.path, referrer: e.referrer, utm: e.utm, itemType: e.itemType, itemId: e.itemId, currency: e.currency };
    add(`${ROLLUP_COUNT_PREFIX}${e.name}`, day, dims, 1);
    if (typeof e.value === "number" && e.value !== 0) add(`${ROLLUP_SUM_PREFIX}${e.name}`, day, dims, e.value);
    if (e.name === PAGE_VIEW) {
      let v = visitors.get(day);
      if (!v) visitors.set(day, (v = { actors: new Set(), anonymousVisits: 0 }));
      const actor = actorKey(e);
      if (actor) v.actors.add(actor);
      else if (e.itemType === ENTRY_MARK) v.anonymousVisits++;
    }
    const count = toEventCount(e);
    for (const stage of REACH_STAGES) {
      if (!STAGE_TESTS[stage](count)) continue;
      const key = `${day}|${stage}`;
      let r = reached.get(key);
      if (!r) reached.set(key, (r = { actors: new Set(), anonymous: 0 }));
      if (count.actor) r.actors.add(count.actor);
      else r.anonymous++;
    }
  }
  for (const [day, v] of visitors) {
    const n = v.actors.size + v.anonymousVisits;
    if (n) add(VISITORS_ROLLUP, day, {}, n);
  }
  for (const [key, r] of reached) {
    const [day, stage] = key.split("|") as [string, ReachStage];
    add(`${ROLLUP_COUNT_PREFIX}${reachName(stage)}`, day, {}, r.actors.size + r.anonymous);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Traffic                                                              */
/* ------------------------------------------------------------------ */

/**
 * Visitors in a period: unique visitors recorded with consent, plus every
 * visit recorded without (they cannot be told apart), plus the daily unique
 * visitors of compacted days.
 */
export function countVisitors(counts: readonly EventCount[]): number {
  const actors = new Set<string>();
  let anonymous = 0;
  let rolled = 0;
  for (const c of counts) {
    if (c.name === "visitors" && !c.raw) rolled += c.count;
    else if (c.name === PAGE_VIEW && c.raw) {
      if (c.actor) actors.add(c.actor);
      else if (c.itemType === ENTRY_MARK) anonymous += 1;
    }
  }
  return actors.size + anonymous + rolled;
}

export function countWhere(counts: readonly EventCount[], test: (c: EventCount) => boolean): number {
  let n = 0;
  for (const c of counts) if (test(c)) n += c.count;
  return n;
}

export const isVisit = (c: EventCount) => c.name === PAGE_VIEW && c.itemType === ENTRY_MARK;
export const isPageView = (c: EventCount) => c.name === PAGE_VIEW;

export const isProductView = (c: EventCount) => c.name === PAGE_VIEW && !!c.path && isProductPage(c.path);
export const isCheckoutStart = (c: EventCount) => c.name === CHECKOUT_STARTED;

/** Funnel stages measured from events (the purchase stage comes from orders). */
const STAGE_TESTS = { visit: isVisit, product: isProductView, checkout: isCheckoutStart } as const;
export type ReachStage = keyof typeof STAGE_TESTS;
const REACH_STAGES = Object.keys(STAGE_TESTS) as ReachStage[];
/** Name (after the rollup prefix) of the daily reach rollup of a stage. */
const reachName = (stage: ReachStage) => `reach:${stage}`;

/**
 * People who reached a funnel stage: unique actors among raw events
 * recorded with an id, plus every raw event recorded anonymously, plus the
 * daily reach of compacted days.
 */
export function reach(counts: readonly EventCount[], stage: ReachStage): number {
  const test = STAGE_TESTS[stage];
  const actors = new Set<string>();
  let other = 0;
  for (const c of counts) {
    if (!c.raw) {
      if (c.name === reachName(stage)) other += c.count;
    } else if (test(c)) {
      if (c.actor) actors.add(c.actor);
      else other += 1;
    }
  }
  return actors.size + other;
}

export interface Ranked {
  key: string;
  label: string;
  value: number;
  /** Optional secondary numbers keyed by metric. */
  extra?: Record<string, number>;
}

/** Group weighted counts by a key, biggest first (ties by label). */
export function rankBy(counts: readonly EventCount[], test: (c: EventCount) => boolean, key: (c: EventCount) => string, label: (key: string) => string = (k) => k): Ranked[] {
  const map = new Map<string, number>();
  for (const c of counts) {
    if (!test(c) || !c.count) continue;
    const k = key(c);
    map.set(k, (map.get(k) ?? 0) + c.count);
  }
  return [...map].map(([k, value]) => ({ key: k, label: label(k), value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export const DIRECT = "(direct)";

export function campaignKey(utm: Utm | undefined): string {
  return [utm?.source || "(none)", utm?.medium || "(none)", utm?.campaign || "(none)"].join(" / ");
}

export interface CampaignRow {
  key: string;
  source: string;
  medium: string;
  campaign: string;
  visits: number;
  signups: number;
  purchases: number;
}

/** Visits, sign-ups and purchases per UTM source / medium / campaign (only tagged traffic). */
export function campaignTable(counts: readonly EventCount[]): CampaignRow[] {
  const map = new Map<string, CampaignRow>();
  for (const c of counts) {
    if (!c.utm || sameUtm(c.utm, undefined)) continue;
    const metric = isVisit(c) ? "visits" : c.name === SIGN_UP ? "signups" : c.name === PURCHASE ? "purchases" : null;
    if (!metric) continue;
    const key = campaignKey(c.utm);
    let row = map.get(key);
    if (!row) map.set(key, (row = { key, source: c.utm.source ?? "", medium: c.utm.medium ?? "", campaign: c.utm.campaign ?? "", visits: 0, signups: 0, purchases: 0 }));
    row[metric] += c.count;
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits || b.purchases - a.purchases || a.key.localeCompare(b.key));
}

export interface ReferrerRow {
  host: string;
  visits: number;
  signups: number;
  purchases: number;
}

/** Visits (and the sign-ups and purchases credited to them) per referring site; direct traffic as `(direct)`. */
export function referrerTable(counts: readonly EventCount[]): ReferrerRow[] {
  const map = new Map<string, ReferrerRow>();
  for (const c of counts) {
    const metric = isVisit(c) ? "visits" : c.name === SIGN_UP ? "signups" : c.name === PURCHASE ? "purchases" : null;
    if (!metric) continue;
    if (metric !== "visits" && !c.referrer) continue;
    const host = c.referrer || DIRECT;
    let row = map.get(host);
    if (!row) map.set(host, (row = { host, visits: 0, signups: 0, purchases: 0 }));
    row[metric] += c.count;
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits || b.purchases - a.purchases || a.host.localeCompare(b.host));
}

/** Daily totals for a line chart. */
export function dailySeries(counts: readonly EventCount[], days: readonly string[], test: (c: EventCount) => boolean): { date: string; value: number }[] {
  const map = new Map<string, number>(days.map((d) => [d, 0]));
  for (const c of counts) {
    if (!test(c)) continue;
    const day = c.at.slice(0, 10);
    if (map.has(day)) map.set(day, map.get(day)! + c.count);
  }
  return days.map((d) => ({ date: d, value: map.get(d) ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* Funnel                                                               */
/* ------------------------------------------------------------------ */

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Share of the previous stage that reached this one (100 for the first stage). */
  stepRate: number;
  /** Share of the previous stage lost before this one. */
  dropOff: number;
  /** Share of the first stage that reached this one. */
  overallRate: number;
}

/**
 * Step and overall conversion of ordered stages. A stage larger than the
 * one before (possible when stages are counted from different sources) is
 * shown as 100% with no drop-off.
 */
export function computeFunnel(stages: readonly { key: string; label: string; count: number }[]): FunnelStage[] {
  const first = stages[0]?.count ?? 0;
  return stages.map((s, i) => {
    const prev = i === 0 ? s.count : stages[i - 1]!.count;
    const stepRate = i === 0 ? 100 : prev > 0 ? Math.min(100, ratio(s.count, prev)) : 0;
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      stepRate,
      dropOff: i === 0 ? 0 : prev > 0 ? Math.round((100 - stepRate) * 10) / 10 : 0,
      overallRate: i === 0 ? (s.count > 0 ? 100 : 0) : Math.min(100, ratio(s.count, first)),
    };
  });
}

/** visit → course or product page → checkout started → purchase. */
export function funnelStages(counts: readonly EventCount[], orders: number): FunnelStage[] {
  return computeFunnel([
    { key: "visit", label: "Visited the site", count: reach(counts, "visit") },
    { key: "product", label: "Viewed a course or offer", count: reach(counts, "product") },
    { key: "checkout", label: "Started checkout", count: reach(counts, "checkout") },
    { key: "purchase", label: "Purchased", count: orders },
  ]);
}

/** Course sales-page views per course slug. */
export function coursePageViews(counts: readonly EventCount[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of counts) {
    if (c.name !== PAGE_VIEW || !c.path) continue;
    const slug = coursePageSlug(c.path);
    if (slug) map.set(slug, (map.get(slug) ?? 0) + c.count);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Revenue                                                              */
/* ------------------------------------------------------------------ */

type PaymentLike = Pick<
  Payment,
  "id" | "userId" | "itemType" | "itemId" | "itemTitle" | "amount" | "taxAmount" | "discountAmount" | "currency" | "status" | "createdAt" | "paidAt" | "refundedAmount" | "refundedAt" | "couponCode" | "affiliateId"
>;

/** An order that was paid at some point (refunded orders were paid first). */
export function wasPaid(p: Pick<Payment, "status">): boolean {
  return p.status === "paid" || p.status === "refunded";
}

export function paidAt(p: Pick<Payment, "paidAt" | "createdAt">): string {
  return p.paidAt ?? p.createdAt;
}

/** Order value without tax. */
export function netOfTax(p: Pick<Payment, "amount" | "taxAmount">): number {
  return Math.max(0, p.amount - (p.taxAmount ?? 0));
}

/** Money refunded on an order (falls back to the whole order when it is marked refunded without an amount). */
export function refundedOf(p: Pick<Payment, "status" | "amount" | "refundedAmount">): number {
  if (p.refundedAmount && p.refundedAmount > 0) return Math.min(p.refundedAmount, p.amount);
  return p.status === "refunded" ? p.amount : 0;
}

export interface RevenueSummary {
  currency: string;
  /** Paid orders in the period. */
  orders: number;
  /** Sales without tax. */
  gross: number;
  tax: number;
  discounts: number;
  /** Money returned in the period (by refund date). */
  refunds: number;
  net: number;
  /** Average order value (gross / orders). */
  aov: number;
  /** Orders of the period that were later refunded, fully or in part. */
  refundedOrders: number;
  refundRate: number;
}

/** Revenue per currency for orders paid (and refunds made) in the period, biggest first. */
export function summarizeRevenue(payments: readonly PaymentLike[], bounds: Bounds): RevenueSummary[] {
  const map = new Map<string, RevenueSummary>();
  const row = (currency: string) => {
    let r = map.get(currency);
    if (!r) map.set(currency, (r = { currency, orders: 0, gross: 0, tax: 0, discounts: 0, refunds: 0, net: 0, aov: 0, refundedOrders: 0, refundRate: 0 }));
    return r;
  };
  for (const p of payments) {
    if (!wasPaid(p)) continue;
    if (inRange(paidAt(p), bounds)) {
      const r = row(p.currency);
      r.orders++;
      r.gross += netOfTax(p);
      r.tax += p.taxAmount ?? 0;
      r.discounts += p.discountAmount ?? 0;
      if (refundedOf(p) > 0) r.refundedOrders++;
    }
    const refunded = refundedOf(p);
    if (refunded > 0 && inRange(p.refundedAt ?? paidAt(p), bounds)) row(p.currency).refunds += refunded;
  }
  for (const r of map.values()) {
    r.net = r.gross - r.refunds;
    r.aov = r.orders ? Math.round(r.gross / r.orders) : 0;
    r.refundRate = ratio(r.refundedOrders, r.orders);
  }
  return [...map.values()].sort((a, b) => b.gross - a.gross || a.currency.localeCompare(b.currency));
}

/** The summary in `currency` (zeros when there were no sales in it). */
export function revenueIn(summaries: readonly RevenueSummary[], currency: string): RevenueSummary {
  return summaries.find((s) => s.currency === currency) ?? { currency, orders: 0, gross: 0, tax: 0, discounts: 0, refunds: 0, net: 0, aov: 0, refundedOrders: 0, refundRate: 0 };
}

export interface ItemRevenue {
  key: string;
  itemType: string;
  itemId: string;
  title: string;
  currency: string;
  orders: number;
  gross: number;
  refunds: number;
  net: number;
}

/** Sales per item (course, bundle, plan, …) and currency for orders paid in the period, best sellers first. */
export function revenueByItem(payments: readonly PaymentLike[], bounds: Bounds): ItemRevenue[] {
  const map = new Map<string, ItemRevenue>();
  for (const p of payments) {
    if (!wasPaid(p) || !inRange(paidAt(p), bounds)) continue;
    const key = `${p.itemType}:${p.itemId}:${p.currency}`;
    let row = map.get(key);
    if (!row) map.set(key, (row = { key, itemType: p.itemType, itemId: p.itemId, title: p.itemTitle, currency: p.currency, orders: 0, gross: 0, refunds: 0, net: 0 }));
    row.orders++;
    row.gross += netOfTax(p);
    row.refunds += refundedOf(p);
    row.net = row.gross - row.refunds;
  }
  return [...map.values()].sort((a, b) => b.net - a.net || b.orders - a.orders || a.title.localeCompare(b.title));
}

/** Net sales per day (major units, rounded) in one currency. */
export function revenueSeries(payments: readonly PaymentLike[], days: readonly string[], currency: string): { date: string; value: number }[] {
  const map = new Map<string, number>(days.map((d) => [d, 0]));
  for (const p of payments) {
    if (!wasPaid(p) || p.currency !== currency) continue;
    const day = paidAt(p).slice(0, 10);
    if (map.has(day)) map.set(day, map.get(day)! + netOfTax(p));
    const refunded = refundedOf(p);
    const refundDay = (p.refundedAt ?? paidAt(p)).slice(0, 10);
    if (refunded > 0 && map.has(refundDay)) map.set(refundDay, map.get(refundDay)! - refunded);
  }
  return days.map((d) => ({ date: d, value: Math.round((map.get(d) ?? 0) / 100) }));
}

export interface CouponRow {
  code: string;
  currency: string;
  orders: number;
  discount: number;
  revenue: number;
}

/** Orders, discount given and sales per coupon code (codes compared case-insensitively). */
export function couponPerformance(payments: readonly PaymentLike[], bounds: Bounds): CouponRow[] {
  const map = new Map<string, CouponRow>();
  for (const p of payments) {
    if (!p.couponCode || !wasPaid(p) || !inRange(paidAt(p), bounds)) continue;
    const code = p.couponCode.trim().toUpperCase();
    const key = `${code}:${p.currency}`;
    let row = map.get(key);
    if (!row) map.set(key, (row = { code, currency: p.currency, orders: 0, discount: 0, revenue: 0 }));
    row.orders++;
    row.discount += p.discountAmount ?? 0;
    row.revenue += netOfTax(p) - refundedOf(p);
  }
  return [...map.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.code.localeCompare(b.code));
}

/* ------------------------------------------------------------------ */
/* Subscriptions (MRR)                                                  */
/* ------------------------------------------------------------------ */

export interface MrrSummary {
  currency: string;
  /** Monthly recurring revenue of paying subscriptions (active), smallest unit. */
  mrr: number;
  active: number;
  trialing: number;
  pastDue: number;
  /** MRR of past-due subscriptions (at risk, not counted in `mrr`). */
  atRisk: number;
  /** Active members who cancelled at period end. */
  cancelling: number;
}

/** Monthly value of one plan price: yearly prices are spread over 12 months; one-time plans recur never. */
export function monthlyValue(plan: Pick<MembershipPlan, "interval" | "price">): number {
  if (plan.interval === "month") return plan.price;
  if (plan.interval === "year") return Math.round(plan.price / 12);
  return 0;
}

/** Current MRR per currency. Trials and one-time plans bring no MRR yet. */
export function computeMrr(subscriptions: readonly Pick<Subscription, "planId" | "status" | "cancelAtPeriodEnd">[], plans: readonly Pick<MembershipPlan, "id" | "interval" | "price" | "currency">[]): MrrSummary[] {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const map = new Map<string, MrrSummary>();
  for (const s of subscriptions) {
    const plan = planById.get(s.planId);
    if (!plan) continue;
    let row = map.get(plan.currency);
    if (!row) map.set(plan.currency, (row = { currency: plan.currency, mrr: 0, active: 0, trialing: 0, pastDue: 0, atRisk: 0, cancelling: 0 }));
    const monthly = monthlyValue(plan);
    if (s.status === "active") {
      row.active++;
      row.mrr += monthly;
      if (s.cancelAtPeriodEnd) row.cancelling++;
    } else if (s.status === "trialing") row.trialing++;
    else if (s.status === "past_due") {
      row.pastDue++;
      row.atRisk += monthly;
    }
  }
  return [...map.values()].sort((a, b) => b.mrr - a.mrr || a.currency.localeCompare(b.currency));
}

/** New and ended subscriptions in the period. */
export function subscriptionMovement(subscriptions: readonly Pick<Subscription, "status" | "createdAt" | "updatedAt">[], bounds: Bounds): { started: number; ended: number } {
  let started = 0;
  let ended = 0;
  for (const s of subscriptions) {
    if (inRange(s.createdAt, bounds)) started++;
    if ((s.status === "cancelled" || s.status === "expired") && inRange(s.updatedAt, bounds)) ended++;
  }
  return { started, ended };
}

/* ------------------------------------------------------------------ */
/* Learners                                                             */
/* ------------------------------------------------------------------ */

/** Members with any learning activity or sign-in in the period. */
export function activeLearners(activity: ReadonlyMap<string, readonly number[]>, bounds: Bounds): number {
  let n = 0;
  for (const times of activity.values()) if (times.some((t) => t >= bounds.startMs && t < bounds.endMs)) n++;
  return n;
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStartMs(ms: number): number {
  const day = new Date(Math.floor(ms / DAY_MS) * DAY_MS);
  const offset = (day.getUTCDay() + 6) % 7;
  return day.getTime() - offset * DAY_MS;
}

export interface CohortRow {
  /** Monday (YYYY-MM-DD, UTC) of the sign-up week. */
  week: string;
  size: number;
  /** Week k after sign-up: share of the cohort active (percent), or null when that week has not started yet. */
  cells: (number | null)[];
}

/**
 * Weekly sign-up cohorts and the share of each that was active 1…`weeks`
 * weeks after signing up. Week k covers days [7k, 7k+7) after each member's
 * own sign-up; it is null until it has started for the cohort's first member.
 */
export function computeCohorts(
  users: readonly { id: string; createdAt: string }[],
  activity: ReadonlyMap<string, readonly number[]>,
  options: { nowMs: number; cohorts: number; weeks: number; endMs?: number },
): CohortRow[] {
  const lastWeek = weekStartMs(Math.min(options.endMs ?? options.nowMs, options.nowMs) - 1);
  const firstWeek = lastWeek - (options.cohorts - 1) * 7 * DAY_MS;
  const groups = new Map<number, { id: string; signupMs: number }[]>();
  for (const u of users) {
    const signupMs = Date.parse(u.createdAt);
    if (!Number.isFinite(signupMs)) continue;
    const week = weekStartMs(signupMs);
    if (week < firstWeek || week > lastWeek) continue;
    (groups.get(week) ?? groups.set(week, []).get(week)!).push({ id: u.id, signupMs });
  }
  const rows: CohortRow[] = [];
  for (let week = lastWeek; week >= firstWeek; week -= 7 * DAY_MS) {
    const members = groups.get(week) ?? [];
    const earliest = members.reduce((min, m) => Math.min(min, m.signupMs), Infinity);
    const cells: (number | null)[] = [];
    for (let k = 1; k <= options.weeks; k++) {
      if (!members.length || earliest + k * 7 * DAY_MS > options.nowMs) {
        cells.push(null);
        continue;
      }
      let active = 0;
      for (const m of members) {
        const from = m.signupMs + k * 7 * DAY_MS;
        const to = from + 7 * DAY_MS;
        if ((activity.get(m.id) ?? []).some((t) => t >= from && t < to)) active++;
      }
      cells.push(ratio(active, members.length));
    }
    rows.push({ week: utcDayKey(week), size: members.length, cells });
  }
  return rows;
}
