import "server-only";
import type { AnalyticsEvent, Database } from "@/lib/types";
import type { DomainEventMap } from "@/lib/events";
import { getDb, mutate } from "@/lib/db/store";
import { csvCell } from "@/components/admin/settings/member-import-csv";
import { uid } from "@/lib/utils";
import { REFERRAL_EVENT } from "./affiliates";
import {
  CHECKOUT_STARTED,
  DAY_MS,
  ENROLL,
  ENTRY_MARK,
  LEAD,
  PAGE_VIEW,
  PURCHASE,
  RETENTION_DAYS,
  SIGN_UP,
  checkoutTarget,
  dayKeys,
  dayStartMs,
  inRange,
  percentChange,
  previousRange,
  rangeBounds,
  ratio,
  referrerHost,
  utcDayKey,
  type BeaconPayload,
  type DateRange,
} from "./analytics-shared";
import {
  activeLearners,
  buildRollups,
  campaignTable,
  computeCohorts,
  computeMrr,
  countVisitors,
  countCheckoutPurchases,
  countWhere,
  couponPerformance,
  dailySeries,
  funnelStages,
  isPageView,
  isRollup,
  isVisit,
  netRevenueOf,
  paidAt,
  rankBy,
  referrerTable,
  revenueByItem,
  revenueIn,
  revenueSeries,
  subscriptionMovement,
  summarizeRevenue,
  toEventCount,
  wasPaid,
  withAttribution,
  type CampaignRow,
  type CohortRow,
  type CouponRow,
  type EventCount,
  type FunnelStage,
  type ItemRevenue,
  type MrrSummary,
  type Ranked,
  type ReferrerRow,
  type RevenueSummary,
} from "./analytics-metrics";

/**
 * First-party analytics on the server (growth area): page views from the
 * beacon (`/api/analytics`), business events from domain events
 * (`growth/handlers.ts`), the 90-day retention job and the report behind
 * `/admin/analytics`.
 */

/** A checkout of the same item by the same visitor within this window counts once. */
const CHECKOUT_DEDUPE_MS = 30 * 60 * 1000;
/** The retention job runs at most this often per server process. */
const COMPACT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const COHORT_COUNT = 8;
const COHORT_WEEKS = 8;

/* ------------------------------------------------------------------ */
/* Recording                                                            */
/* ------------------------------------------------------------------ */

export interface PageViewContext {
  /** Set only with analytics consent. */
  anonId?: string;
  /** Set only with analytics consent. */
  userId?: string;
  /** Host of this site, to drop internal referrers. */
  host: string | null;
}

/** Build the events of one beacon hit: the page view, plus `checkout_started` on a checkout page. */
export function pageViewEvents(payload: BeaconPayload, ctx: PageViewContext, nowMs: number = Date.now()): AnalyticsEvent[] {
  const createdAt = new Date(nowMs).toISOString();
  const view: AnalyticsEvent = { id: uid("evt_"), name: PAGE_VIEW, path: payload.path, createdAt };
  if (ctx.anonId) view.anonId = ctx.anonId;
  if (ctx.userId) view.userId = ctx.userId;
  // Without an id the funnel cannot tell visitors apart: keep the beacon's "first page at this stage in this tab" mark.
  const firstReach = !ctx.anonId && !ctx.userId && payload.firstReach === true;
  if (firstReach) view.firstReach = true;
  if (payload.entry) {
    view.itemType = ENTRY_MARK;
    const host = referrerHost(payload.referrer, ctx.host);
    if (host) view.referrer = host;
    if (payload.utm) view.utm = { ...payload.utm };
  }
  const events = [view];
  const checkout = checkoutTarget(payload.path);
  if (checkout) {
    const start: AnalyticsEvent = { id: uid("evt_"), name: CHECKOUT_STARTED, path: payload.path, itemType: checkout.itemType, itemId: checkout.itemId, createdAt };
    if (ctx.anonId) start.anonId = ctx.anonId;
    if (ctx.userId) start.userId = ctx.userId;
    if (firstReach) start.firstReach = true;
    events.push(start);
  }
  return events;
}

function isDuplicateCheckout(db: Pick<Database, "analyticsEvents">, e: AnalyticsEvent, nowMs: number): boolean {
  if (!e.anonId && !e.userId) return false;
  for (let i = db.analyticsEvents.length - 1; i >= 0; i--) {
    const prev = db.analyticsEvents[i]!;
    if (Date.parse(prev.createdAt) < nowMs - CHECKOUT_DEDUPE_MS) break;
    if (prev.name !== CHECKOUT_STARTED || prev.itemType !== e.itemType || prev.itemId !== e.itemId) continue;
    if ((e.anonId && prev.anonId === e.anonId) || (e.userId && prev.userId === e.userId)) return true;
  }
  return false;
}

/** Store the events of a beacon hit (a repeated checkout start of the same visitor is skipped). */
export async function recordPageView(payload: BeaconPayload, ctx: PageViewContext, nowMs: number = Date.now()): Promise<AnalyticsEvent[]> {
  const events = pageViewEvents(payload, ctx, nowMs);
  return mutate((db) => {
    const kept = events.filter((e) => e.name !== CHECKOUT_STARTED || !isDuplicateCheckout(db, e, nowMs));
    db.analyticsEvents.push(...kept);
    return kept;
  });
}

/**
 * Record that a visitor started the checkout of an item, for code paths that
 * start a checkout without a page view (the order server action, see
 * `checkout-tracking.ts`). Deduplicated like beacon checkouts, so a checkout
 * the beacon already reported for the same visitor or member counts once.
 * Only call it with ids the visitor consented to.
 */
export async function recordCheckoutStarted(input: { userId?: string; anonId?: string; itemType: string; itemId: string }, nowMs: number = Date.now()): Promise<boolean> {
  const event: AnalyticsEvent = { id: uid("evt_"), name: CHECKOUT_STARTED, itemType: input.itemType, itemId: input.itemId, createdAt: new Date(nowMs).toISOString() };
  if (input.anonId) event.anonId = input.anonId;
  if (input.userId) event.userId = input.userId;
  return mutate((db) => {
    if (isDuplicateCheckout(db, event, nowMs)) return false;
    db.analyticsEvents.push(event);
    return true;
  });
}

/** Prefixes of the ids of server-side events (derived from the domain record they describe). */
const SERVER_EVENT_PREFIXES = ["evt_purchase_", "evt_signup_", "evt_enroll_", "evt_lead_"] as const;
const isServerEventId = (id: string) => SERVER_EVENT_PREFIXES.some((prefix) => id.startsWith(prefix));

/**
 * Ids of the server-side events already stored, per events array (a reset,
 * restore or compaction replaces the array, which starts a new index). Built
 * outside the write lock; `recordOnce` keeps it current, so checking for a
 * duplicate no longer scans every page view while all writes wait.
 */
const serverIdIndex = new WeakMap<object, Set<string>>();

async function serverEventIds(): Promise<{ array: object; ids: Set<string> }> {
  const db = await getDb();
  const array = db.analyticsEvents;
  let ids = serverIdIndex.get(array);
  if (!ids) {
    ids = new Set();
    for (const e of array) if (isServerEventId(e.id)) ids.add(e.id);
    serverIdIndex.set(array, ids);
  }
  return { array, ids };
}

/** Insert a server-side event once (its id is derived from the domain record it describes). */
async function recordOnce(event: AnalyticsEvent): Promise<boolean> {
  const index = await serverEventIds();
  return mutate((db) => {
    const events = db.analyticsEvents;
    // The index belongs to the array it was built from; if the array was replaced meanwhile, check directly.
    const ids = events === index.array ? index.ids : serverIdIndex.get(events);
    if (ids ? ids.has(event.id) : events.some((e) => e.id === event.id)) return false;
    events.push(event);
    ids?.add(event.id);
    return true;
  });
}

/** `purchase` with the order value without tax (domain event `payment.paid`). */
export function recordPurchase(data: DomainEventMap["payment.paid"], at: string = new Date().toISOString()): Promise<boolean> {
  return recordOnce({
    id: `evt_purchase_${data.paymentId}`,
    name: PURCHASE,
    userId: data.userId,
    itemType: data.itemType,
    itemId: data.itemId,
    value: Math.max(0, data.amount - data.taxAmount),
    currency: data.currency,
    createdAt: at,
  });
}

/** `sign_up` for accounts people created themselves (domain event `user.registered`). */
export async function recordSignUp(data: DomainEventMap["user.registered"], at: string = new Date().toISOString()): Promise<boolean> {
  if (data.source !== "signup") return false;
  return recordOnce({ id: `evt_signup_${data.userId}`, name: SIGN_UP, userId: data.userId, itemType: data.source, createdAt: at });
}

/** `enroll` (domain event `enrollment.created`). */
export function recordEnrollment(data: DomainEventMap["enrollment.created"], at: string = new Date().toISOString()): Promise<boolean> {
  return recordOnce({ id: `evt_enroll_${data.enrollmentId}`, name: ENROLL, userId: data.userId, itemType: "course", itemId: data.courseId, createdAt: at });
}

/** `lead` without the address (domain event `lead.created`). */
export function recordLead(data: DomainEventMap["lead.created"], at: string = new Date().toISOString()): Promise<boolean> {
  const event: AnalyticsEvent = { id: `evt_lead_${data.leadId}`, name: LEAD, itemType: data.source.slice(0, 80), createdAt: at };
  if (data.courseId) event.itemId = data.courseId;
  return recordOnce(event);
}

/* ------------------------------------------------------------------ */
/* Retention                                                            */
/* ------------------------------------------------------------------ */

/** Raw events created before this instant are folded into rollups. */
export function retentionCutoffMs(nowMs: number): number {
  return dayStartMs(utcDayKey(nowMs)) - RETENTION_DAYS * DAY_MS;
}

/**
 * Fold raw events older than `RETENTION_DAYS` (whole UTC days) into daily
 * rollups and delete them. Sign-ups and purchases are credited to their
 * campaign first, so the rollups keep that attribution. Affiliate referral
 * links stay raw: commissions rely on them.
 *
 * The work is planned outside the write lock (stored events never change,
 * and only this job writes rollups); the lock is held just long enough to
 * check the plan still applies and swap the rows in with one `filter`
 * assignment, which the store records as the removals and additions it is.
 */
export async function compactAnalytics(nowMs: number = Date.now()): Promise<{ compacted: number; rollups: number }> {
  const cutoff = retentionCutoffMs(nowMs);
  const db = await getDb();
  const old: AnalyticsEvent[] = [];
  const linking: AnalyticsEvent[] = [];
  const existing: AnalyticsEvent[] = [];
  for (const e of db.analyticsEvents) {
    if (isRollup(e)) existing.push(e);
    else if (e.name === REFERRAL_EVENT) continue;
    else if (Date.parse(e.createdAt) < cutoff) old.push(e);
    // Later events can still tie a visitor id to a member, which attribution of old conversions needs.
    else if (e.userId && e.anonId) linking.push(e);
  }
  if (!old.length) return { compacted: 0, rollups: 0 };

  // Attribution only looks back in time, so the expired events plus the visitor↔member links are enough.
  const attributed = withAttribution([...old, ...linking]).slice(0, old.length);
  const before = new Map(existing.map((r) => [r.id, r.value ?? 0]));
  const built = buildRollups(attributed, existing, () => uid("evr_"));
  // A rollup that grew is replaced by a copy with a new id, so the swap below is removals plus additions only.
  const replaced = new Set<string>();
  const additions: AnalyticsEvent[] = [];
  for (const row of built) {
    const previous = before.get(row.id);
    if (previous === undefined) additions.push(row);
    else if ((row.value ?? 0) !== previous) {
      replaced.add(row.id);
      additions.push({ ...row, id: uid("evr_") });
    }
  }
  const oldIds = new Set(old.map((e) => e.id));

  return mutate((d) => {
    // Stop if another run or an erasure changed what was planned; the next run starts over.
    let foundOld = 0;
    let foundReplaced = 0;
    const stale = d.analyticsEvents.some((e) => {
      if (oldIds.has(e.id)) foundOld++;
      else if (replaced.has(e.id)) {
        foundReplaced++;
        return (e.value ?? 0) !== before.get(e.id);
      }
      return false;
    });
    if (stale || foundOld !== oldIds.size || foundReplaced !== replaced.size) return { compacted: 0, rollups: 0 };
    d.analyticsEvents = d.analyticsEvents.filter((e) => !oldIds.has(e.id) && !replaced.has(e.id));
    d.analyticsEvents.push(...additions);
    return { compacted: old.length, rollups: built.length - existing.length };
  });
}

const g = globalThis as unknown as { __llAnalyticsCompactedAt?: number; __llAnalyticsCompacting?: Promise<unknown> };

/** Run the retention job when it has not run in this process for `COMPACT_INTERVAL_MS`. Never throws. */
export async function maybeCompactAnalytics(nowMs: number = Date.now()): Promise<void> {
  if (g.__llAnalyticsCompacting || (g.__llAnalyticsCompactedAt && nowMs - g.__llAnalyticsCompactedAt < COMPACT_INTERVAL_MS)) return;
  g.__llAnalyticsCompactedAt = nowMs;
  g.__llAnalyticsCompacting = compactAnalytics(nowMs)
    .catch((error) => console.error("[analytics] retention job failed:", error instanceof Error ? error.message : String(error)))
    .finally(() => {
      g.__llAnalyticsCompacting = undefined;
    });
  await g.__llAnalyticsCompacting;
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

/** Timestamps of each member's learning activity and sign-ins (for active learners and cohorts). */
export function activityByUser(db: Pick<Database, "activities" | "progress" | "loginEvents" | "users">): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const push = (userId: string | undefined, iso: string | undefined) => {
    if (!userId || !iso) return;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return;
    (map.get(userId) ?? map.set(userId, []).get(userId)!).push(ms);
  };
  for (const a of db.activities) push(a.userId, a.createdAt);
  for (const p of db.progress) push(p.userId, p.updatedAt);
  for (const l of db.loginEvents) if (l.success) push(l.userId, l.createdAt);
  for (const u of db.users) push(u.id, u.lastActiveAt);
  return map;
}

export interface ItemRevenueView extends ItemRevenue {
  href?: string;
}

export interface AffiliatePerformance {
  affiliateId: string;
  code: string;
  name: string;
  clicks: number;
  sales: number;
  revenue: { currency: string; amount: number }[];
  commission: { currency: string; amount: number }[];
}

export interface AnalyticsReport {
  range: DateRange;
  previous: DateRange;
  currency: string;
  kpis: {
    visitors: number;
    visitorsTrend: number | null;
    pageViews: number;
    signups: number;
    signupsTrend: number | null;
    orders: number;
    conversionRate: number;
    conversionTrend: number | null;
    revenue: RevenueSummary;
    revenueTrend: number | null;
    aovTrend: number | null;
    otherCurrencies: RevenueSummary[];
    activeLearners: number;
    activeLearnersTrend: number | null;
  };
  series: { date: string; visits: number; pageViews: number; signups: number; orders: number; revenue: number }[];
  funnel: FunnelStage[];
  revenueByItem: ItemRevenueView[];
  revenueByType: { itemType: string; net: number }[];
  subscriptions: { mrr: MrrSummary[]; started: number; ended: number };
  landingPages: Ranked[];
  referrers: ReferrerRow[];
  campaigns: CampaignRow[];
  coupons: CouponRow[];
  affiliates: AffiliatePerformance[];
  cohorts: CohortRow[];
  tracking: { rawEvents: number; rollupRows: number; oldestRaw: string | null; consentedShare: number };
}

function addTo(list: { currency: string; amount: number }[], currency: string, amount: number): void {
  const row = list.find((r) => r.currency === currency);
  if (row) row.amount += amount;
  else list.push({ currency, amount });
}

function itemHref(db: Database, itemType: string, itemId: string): string | undefined {
  if (itemType === "course") {
    const course = db.courses.find((c) => c.id === itemId);
    return course ? `/courses/${course.slug}` : undefined;
  }
  if (itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === itemId);
    return bundle ? `/bundles/${bundle.slug}` : undefined;
  }
  if (itemType === "batch") {
    const batch = db.batches.find((b) => b.id === itemId);
    return batch ? `/batches/${batch.slug}` : undefined;
  }
  if (itemType === "plan") return "/pricing";
  if (itemType === "seats") return "/admin/teams";
  return undefined;
}

function affiliatePerformance(db: Database, bounds: { startMs: number; endMs: number }): AffiliatePerformance[] {
  const rows = new Map<string, AffiliatePerformance>();
  const row = (affiliateId: string): AffiliatePerformance | null => {
    const existing = rows.get(affiliateId);
    if (existing) return existing;
    const affiliate = db.affiliates.find((a) => a.id === affiliateId);
    if (!affiliate) return null;
    const user = db.users.find((u) => u.id === affiliate.userId);
    const created: AffiliatePerformance = { affiliateId, code: affiliate.code, name: user?.name ?? affiliate.code, clicks: 0, sales: 0, revenue: [], commission: [] };
    rows.set(affiliateId, created);
    return created;
  };
  for (const click of db.affiliateReferrals) {
    if (!inRange(click.createdAt, bounds)) continue;
    const r = row(click.affiliateId);
    if (r) r.clicks++;
  }
  for (const c of db.commissions) {
    if (c.status === "void" || !inRange(c.createdAt, bounds)) continue;
    const r = row(c.affiliateId);
    if (!r) continue;
    addTo(r.commission, c.currency, c.amount);
  }
  for (const p of db.payments) {
    if (!p.affiliateId || !wasPaid(p) || !inRange(paidAt(p), bounds)) continue;
    const r = row(p.affiliateId);
    if (!r) continue;
    r.sales++;
    addTo(r.revenue, p.currency, netRevenueOf(p));
  }
  return [...rows.values()].filter((r) => r.clicks || r.sales).sort((a, b) => b.sales - a.sales || b.clicks - a.clicks || a.code.localeCompare(b.code));
}

/** Everything `/admin/analytics` shows for a period. */
export async function getAnalyticsReport(range: DateRange, nowMs: number = Date.now()): Promise<AnalyticsReport> {
  const db = await getDb();
  const currency = db.settings.commerce.defaultCurrency;
  const previous = previousRange(range);
  const bounds = rangeBounds(range);
  const prevBounds = rangeBounds(previous);
  const days = dayKeys(range);

  const raw: AnalyticsEvent[] = [];
  const rollups: AnalyticsEvent[] = [];
  for (const e of db.analyticsEvents) {
    if (e.name === REFERRAL_EVENT) continue;
    (isRollup(e) ? rollups : raw).push(e);
  }
  // Attribution looks back before the period, so it runs over every raw event.
  const attributed = withAttribution(raw);
  const counts: EventCount[] = [];
  const prevCounts: EventCount[] = [];
  for (const e of [...attributed, ...rollups]) {
    if (inRange(e.createdAt, bounds)) counts.push(toEventCount(e));
    else if (inRange(e.createdAt, prevBounds)) prevCounts.push(toEventCount(e));
  }

  const revenue = summarizeRevenue(db.payments, bounds);
  const prevRevenue = summarizeRevenue(db.payments, prevBounds);
  const main = revenueIn(revenue, currency);
  const prevMain = revenueIn(prevRevenue, currency);
  const ordersAll = revenue.reduce((n, r) => n + r.orders, 0);

  const visitors = countVisitors(counts);
  const prevVisitors = countVisitors(prevCounts);
  const signups = db.users.filter((u) => inRange(u.createdAt, bounds)).length;
  const prevSignups = db.users.filter((u) => inRange(u.createdAt, prevBounds)).length;
  // Conversion and the funnel's last stage count checkouts that ended in an order, not renewals or installment parts.
  const purchases = countCheckoutPurchases(db.payments, bounds);
  const conversionRate = ratio(purchases, visitors);
  const prevConversion = ratio(countCheckoutPurchases(db.payments, prevBounds), prevVisitors);
  const activity = activityByUser(db);
  const active = activeLearners(activity, bounds);
  const prevActive = activeLearners(activity, prevBounds);

  const visitSeries = dailySeries(counts, days, isVisit);
  const viewSeries = dailySeries(counts, days, isPageView);
  const revSeries = revenueSeries(db.payments, days, currency);
  const signupByDay = new Map<string, number>();
  for (const u of db.users) if (inRange(u.createdAt, bounds)) signupByDay.set(u.createdAt.slice(0, 10), (signupByDay.get(u.createdAt.slice(0, 10)) ?? 0) + 1);
  const ordersByDay = new Map<string, number>();
  for (const p of db.payments) if (wasPaid(p) && inRange(paidAt(p), bounds)) ordersByDay.set(paidAt(p).slice(0, 10), (ordersByDay.get(paidAt(p).slice(0, 10)) ?? 0) + 1);

  const items = revenueByItem(db.payments, bounds);
  const byType = new Map<string, number>();
  for (const i of items) if (i.currency === currency) byType.set(i.itemType, (byType.get(i.itemType) ?? 0) + i.net);

  const rawInRange = counts.filter((c) => c.raw && c.name === PAGE_VIEW);
  const oldestRaw = raw.reduce<string | null>((min, e) => (min === null || e.createdAt < min ? e.createdAt : min), null);
  const learners = db.users.filter((u) => !u.roles.includes("admin"));

  return {
    range,
    previous,
    currency,
    kpis: {
      visitors,
      visitorsTrend: percentChange(visitors, prevVisitors),
      pageViews: countWhere(counts, isPageView),
      signups,
      signupsTrend: percentChange(signups, prevSignups),
      orders: ordersAll,
      conversionRate,
      conversionTrend: percentChange(conversionRate, prevConversion),
      revenue: main,
      revenueTrend: percentChange(main.net, prevMain.net),
      aovTrend: percentChange(main.aov, prevMain.aov),
      otherCurrencies: revenue.filter((r) => r.currency !== currency),
      activeLearners: active,
      activeLearnersTrend: percentChange(active, prevActive),
    },
    series: days.map((date, i) => ({
      date,
      visits: visitSeries[i]!.value,
      pageViews: viewSeries[i]!.value,
      signups: signupByDay.get(date) ?? 0,
      orders: ordersByDay.get(date) ?? 0,
      revenue: revSeries[i]!.value,
    })),
    funnel: funnelStages(counts, purchases),
    revenueByItem: items.map((i) => ({ ...i, href: itemHref(db, i.itemType, i.itemId) })),
    revenueByType: [...byType].map(([itemType, net]) => ({ itemType, net })).sort((a, b) => b.net - a.net),
    subscriptions: { mrr: computeMrr(db.subscriptions, db.plans), ...subscriptionMovement(db.subscriptions, bounds) },
    landingPages: rankBy(counts, isVisit, (c) => c.path ?? "/"),
    referrers: referrerTable(counts),
    campaigns: campaignTable(counts),
    coupons: couponPerformance(db.payments, bounds),
    affiliates: affiliatePerformance(db, bounds),
    cohorts: computeCohorts(learners, activity, { nowMs, cohorts: COHORT_COUNT, weeks: COHORT_WEEKS, endMs: bounds.endMs }),
    tracking: {
      rawEvents: raw.length,
      rollupRows: rollups.length,
      oldestRaw,
      consentedShare: ratio(rawInRange.filter((c) => c.actor).length, rawInRange.length),
    },
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

export const EXPORT_SECTIONS = ["daily", "funnel", "revenue", "landing", "referrers", "campaigns", "coupons", "affiliates", "cohorts"] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export function isExportSection(value: unknown): value is ExportSection {
  return typeof value === "string" && (EXPORT_SECTIONS as readonly string[]).includes(value);
}

type Cell = string | number;
const major = (amount: number) => Number((amount / 100).toFixed(2));
const moneyCells = (list: { currency: string; amount: number }[]) => list.map((m) => `${(m.amount / 100).toFixed(2)} ${m.currency}`).join(" + ");

function toCsv(rows: readonly Cell[][]): string {
  // Numbers are written as-is (a negative net stays numeric); text goes through the formula-safe `csvCell`.
  return rows.map((row) => row.map((cell) => (typeof cell === "number" ? String(cell) : csvCell(cell))).join(",")).join("\r\n");
}

/** One section of the report as CSV (money in major units). */
export function reportToCsv(report: AnalyticsReport, section: ExportSection): string {
  switch (section) {
    case "daily":
      return toCsv([
        ["Date", "Visits", "Page views", "Sign-ups", "Orders", `Net revenue (${report.currency})`],
        ...report.series.map((d) => [d.date, d.visits, d.pageViews, d.signups, d.orders, d.revenue]),
      ]);
    case "funnel":
      return toCsv([["Stage", "Count", "Step conversion %", "Drop-off %", "Overall conversion %"], ...report.funnel.map((s) => [s.label, s.count, s.stepRate, s.dropOff, s.overallRate])]);
    case "revenue":
      return toCsv([
        ["Type", "Item", "Item ID", "Currency", "Orders", "Sales (excl. tax)", "Refunds", "Net"],
        ...report.revenueByItem.map((i) => [i.itemType, i.title, i.itemId, i.currency, i.orders, major(i.gross), major(i.refunds), major(i.net)]),
      ]);
    case "landing":
      return toCsv([["Landing page", "Visits"], ...report.landingPages.map((r) => [r.label, r.value])]);
    case "referrers":
      return toCsv([["Referrer", "Visits", "Sign-ups", "Purchases"], ...report.referrers.map((r) => [r.host, r.visits, r.signups, r.purchases])]);
    case "campaigns":
      return toCsv([["Source", "Medium", "Campaign", "Visits", "Sign-ups", "Purchases"], ...report.campaigns.map((r) => [r.source, r.medium, r.campaign, r.visits, r.signups, r.purchases])]);
    case "coupons":
      return toCsv([["Coupon", "Currency", "Orders", "Discount given", "Net revenue"], ...report.coupons.map((c) => [c.code, c.currency, c.orders, major(c.discount), major(c.revenue)])]);
    case "affiliates":
      return toCsv([["Code", "Affiliate", "Clicks", "Sales", "Net revenue", "Commission"], ...report.affiliates.map((a) => [a.code, a.name, a.clicks, a.sales, moneyCells(a.revenue), moneyCells(a.commission)])]);
    case "cohorts": {
      const weeks = report.cohorts[0]?.cells.length ?? 0;
      return toCsv([
        ["Sign-up week", "Members", ...Array.from({ length: weeks }, (_, i) => `Week ${i + 1} active %`)],
        ...report.cohorts.map((c) => [c.week, c.size, ...c.cells.map((v) => (v === null ? "" : v))]),
      ]);
    }
  }
}
