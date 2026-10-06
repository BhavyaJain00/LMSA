import "server-only";
import type { Affiliate, AffiliateReferral, AnalyticsEvent, Commission, Database, Payment, Payout, User } from "@/lib/types";
import type { DomainEventMap } from "@/lib/events";
import { getDb, mutate } from "@/lib/db/store";
import { notify, notifyMany } from "@/lib/services/notifications";
import { csvCell } from "@/components/admin/settings/member-import-csv";
import { formatPrice, toDateKey, uid } from "@/lib/utils";
import {
  CLICK_DEDUPE_MS,
  commissionBase,
  commissionIneligibility,
  commissionTotals,
  computeCommission,
  fraudFlags,
  payableBalances,
  pickLastClick,
  planRefund,
  rate,
  sanitizeLandingPath,
  uniqueCode,
  type AffiliateFilter,
  type CommissionFilter,
  type CommissionIneligibility,
  type CommissionRowView,
  type CurrencyTotals,
  type FraudFlag,
  type ShareTargetGroup,
  methodLabel,
} from "./affiliates-shared";
import { isInstallmentOrder, planKeyOf } from "@/lib/commerce/installments";

/**
 * Affiliate programme on the server (growth area): referral clicks, member
 * attribution, commissions (credited on `payment.paid`, reversed on
 * `payment.refunded`), payouts and the queries behind `/affiliate` and
 * `/admin/affiliates`.
 *
 * A signed-in member who arrives through a referral link is linked to the
 * affiliate with an `affiliate_referral` analytics event dated at the click.
 * Those events drive the "sign-ups" metric and attribute a sale when the
 * order itself carries no `affiliateId`.
 */

/** AnalyticsEvent name linking a member to an affiliate click (kept out of analytics rollups). */
export const REFERRAL_EVENT = "affiliate_referral";
export const ADMIN_PAGE_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Account created up to this long before the recorded click still counts as a referred sign-up (clock skew). */
const SIGNUP_SKEW_MS = 60 * 1000;

export function findAffiliateByCode(db: Pick<Database, "affiliates">, code: string): Affiliate | undefined {
  const upper = code.toUpperCase();
  return db.affiliates.find((a) => a.code.toUpperCase() === upper);
}

export async function getAffiliateForUser(userId: string): Promise<Affiliate | null> {
  const db = await getDb();
  return db.affiliates.find((a) => a.userId === userId) ?? null;
}

function adminIds(db: Pick<Database, "users">): string[] {
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

/* ------------------------------------------------------------------ */
/* Clicks and member attribution                                       */
/* ------------------------------------------------------------------ */

export interface ClickInput {
  code: string;
  /** Click time from the referral cookie (epoch ms). */
  at: number;
  visitorId?: string;
  landingPath: string;
  /** Signed-in visitor, if any (their own link never counts). */
  userId?: string;
}

/**
 * Record one referral click. Skipped when the programme is off, the code is
 * unknown or not active, the visitor is the affiliate, or the same visitor
 * already clicked this affiliate's link in the last 30 minutes.
 */
export async function recordReferralClick(input: ClickInput): Promise<AffiliateReferral | null> {
  if (!input.visitorId) return null;
  const visitorId = input.visitorId;
  return mutate((d) => {
    if (!d.settings.growth.affiliatesEnabled) return null;
    const affiliate = findAffiliateByCode(d, input.code);
    if (!affiliate || affiliate.status !== "active") return null;
    if (input.userId && input.userId === affiliate.userId) return null;
    const recent = d.affiliateReferrals.some(
      (r) => r.affiliateId === affiliate.id && r.visitorId === visitorId && Math.abs(Date.parse(r.createdAt) - input.at) < CLICK_DEDUPE_MS,
    );
    if (recent) return null;
    const referral: AffiliateReferral = {
      id: uid("ref"),
      affiliateId: affiliate.id,
      visitorId,
      landingPath: sanitizeLandingPath(input.landingPath),
      createdAt: new Date(input.at).toISOString(),
    };
    d.affiliateReferrals.push(referral);
    return referral;
  });
}

/**
 * Link a signed-in member to the affiliate click in their referral cookie
 * (once per member and click). Their own code is ignored.
 */
export async function linkMemberToReferral(input: { userId: string; code: string; at: number }): Promise<boolean> {
  return mutate((d) => {
    if (!d.settings.growth.affiliatesEnabled) return false;
    const affiliate = findAffiliateByCode(d, input.code);
    if (!affiliate || affiliate.status !== "active" || affiliate.userId === input.userId) return false;
    const createdAt = new Date(input.at).toISOString();
    const exists = d.analyticsEvents.some((e) => e.name === REFERRAL_EVENT && e.userId === input.userId && e.itemId === affiliate.id && e.createdAt === createdAt);
    if (exists) return false;
    const event: AnalyticsEvent = { id: uid("evt"), name: REFERRAL_EVENT, userId: input.userId, itemType: "affiliate", itemId: affiliate.id, createdAt };
    d.analyticsEvents.push(event);
    return true;
  });
}

/** Referral clicks linked to a member, newest click first. */
export function memberClicks(db: Pick<Database, "analyticsEvents">, userId: string): { affiliateId: string; at: number }[] {
  return db.analyticsEvents
    .filter((e) => e.name === REFERRAL_EVENT && e.userId === userId && e.itemId)
    .map((e) => ({ affiliateId: e.itemId as string, at: Date.parse(e.createdAt) }))
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => b.at - a.at);
}

/** The affiliate credited for a member's action at `atMs` (last click inside the window), if any. */
export function attributedAffiliateId(db: Pick<Database, "analyticsEvents" | "settings">, userId: string, atMs: number): string | null {
  const click = pickLastClick(memberClicks(db, userId), atMs, db.settings.growth.cookieDays);
  return click?.affiliateId ?? null;
}

/* ------------------------------------------------------------------ */
/* Commissions                                                         */
/* ------------------------------------------------------------------ */

/**
 * The order a follow-on charge belongs to: the first part of an installment
 * plan (for parts 2..n), the subscription's original checkout (for renewals)
 * or the order whose checkout offered a one-click upsell / order bump.
 * `undefined` when `payment` is an order of its own; `null` when it is a
 * follow-on whose original order is gone.
 */
export function anchorOrderOf(db: Pick<Database, "payments">, payment: Payment): Payment | null | undefined {
  if (isInstallmentOrder(payment) && (payment.installmentNumber ?? 1) > 1) {
    const key = planKeyOf(payment);
    return db.payments.find((p) => p.orderId === key && p.userId === payment.userId && p.itemId === payment.itemId && p.installmentNumber === 1) ?? null;
  }
  if (payment.subscriptionId && payment.source === "Renewal") {
    const first = db.payments
      .filter((p) => p.id !== payment.id && p.subscriptionId === payment.subscriptionId && p.source !== "Renewal")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return first ?? null;
  }
  if (payment.upsellOfPaymentId) return db.payments.find((p) => p.id === payment.upsellOfPaymentId) ?? null;
  return undefined;
}

/** The affiliate that referred an order, as recorded on it or on its commission. */
function orderAffiliateId(db: Pick<Database, "commissions">, order: Payment): string | undefined {
  return order.affiliateId ?? db.commissions.find((c) => c.paymentId === order.id && c.amount > 0)?.affiliateId;
}

export type CreditResult =
  | { credited: true; commission: Commission; affiliate: Affiliate; payment: Payment }
  | { credited: false; reason: CommissionIneligibility | "missing" | "not_paid" };

/**
 * Credit the affiliate of a paid order: the order's own `affiliateId`
 * (set at checkout from the referral cookie), otherwise the buyer's last
 * referral click inside the window. Follow-on charges (installment parts
 * 2..n, subscription renewals, upsells) belong to the affiliate who referred
 * the original order and never to a later click. Idempotent per order.
 */
export async function creditCommission(paymentId: string, hintAffiliateId?: string): Promise<CreditResult> {
  const result = await mutate((d): CreditResult => {
    const payment = d.payments.find((p) => p.id === paymentId);
    if (!payment) return { credited: false, reason: "missing" };
    if (payment.status !== "paid") return { credited: false, reason: "not_paid" };
    const paidAt = Date.parse(payment.paidAt ?? payment.createdAt);
    const anchor = anchorOrderOf(d, payment);
    const followOn = anchor !== undefined;
    const affiliateId =
      hintAffiliateId || payment.affiliateId || (followOn ? (anchor ? orderAffiliateId(d, anchor) : undefined) : attributedAffiliateId(d, payment.userId, paidAt));
    const affiliate = affiliateId ? d.affiliates.find((a) => a.id === affiliateId) : undefined;
    const base = commissionBase(payment);
    const why = commissionIneligibility({
      enabled: d.settings.growth.affiliatesEnabled,
      affiliate,
      buyerId: payment.userId,
      base,
      percent: affiliate?.commissionPercent ?? 0,
      alreadyCredited: d.commissions.some((c) => c.paymentId === payment.id),
    });
    if (why || !affiliate) return { credited: false, reason: why ?? "no_affiliate" };

    const commission: Commission = {
      id: uid("com"),
      affiliateId: affiliate.id,
      paymentId: payment.id,
      amount: computeCommission(base, affiliate.commissionPercent),
      currency: payment.currency,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    d.commissions.push(commission);
    if (!payment.affiliateId) payment.affiliateId = affiliate.id;
    // Mark the click that led to the sale (the member's latest click on this affiliate before paying).
    const click = followOn ? undefined : memberClicks(d, payment.userId).find((c) => c.affiliateId === affiliate.id && c.at <= paidAt + 5 * 60 * 1000);
    if (click) {
      const iso = new Date(click.at).toISOString();
      const referral = d.affiliateReferrals.find((r) => r.affiliateId === affiliate.id && r.createdAt === iso && !r.convertedPaymentId);
      if (referral) referral.convertedPaymentId = payment.id;
    }
    return { credited: true, commission: { ...commission }, affiliate: { ...affiliate }, payment: { ...payment } };
  });

  if (result.credited) {
    await notify(result.affiliate.userId, {
      type: "system",
      subject: `You earned a ${formatPrice(result.commission.amount, result.commission.currency)} commission`,
      message: `A purchase of ${result.payment.itemTitle} through your referral link. It becomes payable once approved.`,
      link: "/affiliate",
      dedupeKey: `commission:${result.commission.id}`,
    });
  }
  return result;
}

/**
 * Reduce or void the commission of a refunded order (see `planRefund`).
 * Already paid commissions are clawed back with a negative row that is
 * deducted from the affiliate's next payout.
 */
export async function reverseCommissionForRefund(data: DomainEventMap["payment.refunded"]): Promise<{ voided: number; adjustment: Commission | null }> {
  const outcome = await mutate((d) => {
    const rows = d.commissions.filter((c) => c.paymentId === data.paymentId);
    if (!rows.length) return null;
    const plan = planRefund(rows, { amount: data.amount, refundedAmount: data.refundedAmount, full: data.full });
    for (const id of plan.voidIds) {
      const row = d.commissions.find((c) => c.id === id);
      if (row) row.status = "void";
    }
    let adjustment: Commission | null = null;
    if (plan.adjustment) {
      const original = rows.find((r) => r.amount > 0) ?? rows[0];
      adjustment = {
        id: uid("com"),
        affiliateId: original.affiliateId,
        paymentId: data.paymentId,
        amount: plan.adjustment.amount,
        currency: original.currency,
        status: plan.adjustment.status,
        createdAt: new Date().toISOString(),
      };
      d.commissions.push(adjustment);
    }
    const affiliate = d.affiliates.find((a) => a.id === rows[0].affiliateId);
    const payment = d.payments.find((p) => p.id === data.paymentId);
    return { voided: plan.voidIds.length, adjustment, userId: affiliate?.userId, itemTitle: payment?.itemTitle ?? "an order", currency: rows[0].currency };
  });
  if (!outcome) return { voided: 0, adjustment: null };
  if (outcome.userId && (outcome.voided || outcome.adjustment)) {
    await notify(outcome.userId, {
      type: "system",
      subject: outcome.voided ? "A commission was cancelled after a refund" : "A commission was reduced after a refund",
      message: outcome.adjustment
        ? `${outcome.itemTitle} was refunded; ${formatPrice(-outcome.adjustment.amount, outcome.currency)} is deducted from your commissions.`
        : `${outcome.itemTitle} was refunded, so its commission no longer applies.`,
      link: "/affiliate",
      dedupeKey: `commission-refund:${data.paymentId}:${data.refundedAmount}`,
    });
  }
  return { voided: outcome.voided, adjustment: outcome.adjustment };
}

/** Approve pending commissions (and the pending refund corrections of the same orders). */
export async function approveCommissions(ids: readonly string[]): Promise<{ approved: number; affiliateUserIds: string[] }> {
  const wanted = new Set(ids);
  return mutate((d) => {
    const payments = new Set(d.commissions.filter((c) => wanted.has(c.id) && c.status === "pending").map((c) => c.paymentId));
    let approved = 0;
    const affiliates = new Set<string>();
    for (const c of d.commissions) {
      if (c.status !== "pending") continue;
      if (!wanted.has(c.id) && !(payments.has(c.paymentId) && c.amount < 0)) continue;
      c.status = "approved";
      approved++;
      affiliates.add(c.affiliateId);
    }
    const affiliateUserIds = d.affiliates.filter((a) => affiliates.has(a.id)).map((a) => a.userId);
    return { approved, affiliateUserIds };
  });
}

/**
 * Void unpaid commissions. Voiding an order's original commission voids its
 * unpaid corrections too; paid rows are never touched.
 */
export async function voidCommissions(ids: readonly string[]): Promise<{ voided: number; skippedPaid: number }> {
  const wanted = new Set(ids);
  return mutate((d) => {
    const selected = d.commissions.filter((c) => wanted.has(c.id));
    const skippedPaid = selected.filter((c) => c.status === "paid").length;
    const originals = new Set(selected.filter((c) => c.amount > 0 && c.status !== "paid" && c.status !== "void").map((c) => c.paymentId));
    let voided = 0;
    for (const c of d.commissions) {
      if (c.status === "paid" || c.status === "void") continue;
      if (!wanted.has(c.id) && !originals.has(c.paymentId)) continue;
      c.status = "void";
      voided++;
    }
    return { voided, skippedPaid };
  });
}

export type PayoutResult = { ok: true; payout: Payout; count: number } | { ok: false; error: string };

/**
 * Pay an affiliate's approved balance in one currency: marks every approved
 * row (corrections included) paid and records a `Payout` of the net amount.
 */
export async function recordAffiliatePayout(input: { affiliateId: string; currency: string; method: string; reference?: string }): Promise<PayoutResult> {
  const result = await mutate((d): PayoutResult & { userId?: string } => {
    const affiliate = d.affiliates.find((a) => a.id === input.affiliateId);
    if (!affiliate) return { ok: false, error: "This affiliate no longer exists." };
    const rows = d.commissions.filter((c) => c.affiliateId === affiliate.id && c.currency === input.currency && c.status === "approved");
    const amount = rows.reduce((s, c) => s + c.amount, 0);
    if (!rows.length || amount <= 0) return { ok: false, error: `There is no approved ${input.currency} balance to pay.` };
    const now = new Date().toISOString();
    for (const row of rows) {
      row.status = "paid";
      row.paidAt = now;
    }
    const payout: Payout = { id: uid("pout"), affiliateId: affiliate.id, amount, currency: input.currency, method: input.method, reference: input.reference || undefined, createdAt: now };
    d.payouts.push(payout);
    return { ok: true, payout: { ...payout }, count: rows.length, userId: affiliate.userId };
  });
  if (result.ok && result.userId) {
    await notify(result.userId, {
      type: "system",
      subject: `Payout sent: ${formatPrice(result.payout.amount, result.payout.currency)}`,
      message: `Your affiliate commissions were paid by ${methodLabel(result.payout.method)}${result.payout.reference ? ` (reference ${result.payout.reference})` : ""}.`,
      link: "/affiliate?tab=payouts",
      dedupeKey: `payout:${result.payout.id}`,
    });
  }
  if (!result.ok) return result;
  return { ok: true, payout: result.payout, count: result.count };
}

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

export type ApplyResult = { ok: true; affiliate: Affiliate; created: boolean } | { ok: false; error: string };

/** Join the programme: active at once with auto-approval, otherwise pending review. */
export async function applyForAffiliate(user: Pick<User, "id" | "username" | "name">, payoutEmail: string | undefined): Promise<ApplyResult> {
  const result = await mutate((d): ApplyResult => {
    const g = d.settings.growth;
    if (!g.affiliatesEnabled) return { ok: false, error: "The affiliate program is closed right now." };
    const existing = d.affiliates.find((a) => a.userId === user.id);
    if (existing) return { ok: true, affiliate: { ...existing }, created: false };
    const affiliate: Affiliate = {
      id: uid("aff"),
      userId: user.id,
      code: uniqueCode(user.username || user.name, d.affiliates.map((a) => a.code)),
      commissionPercent: g.defaultCommissionPercent,
      status: g.affiliateAutoApprove ? "active" : "pending",
      payoutEmail: payoutEmail || undefined,
      createdAt: new Date().toISOString(),
    };
    d.affiliates.push(affiliate);
    return { ok: true, affiliate: { ...affiliate }, created: true };
  });
  if (result.ok && result.created && result.affiliate.status === "pending") {
    const db = await getDb();
    await notifyMany(adminIds(db), {
      type: "system",
      subject: `${user.name} applied to become an affiliate`,
      message: "Review the application in Affiliates.",
      link: "/admin/affiliates?status=pending",
      fromUserId: user.id,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export interface AffiliateStats {
  clicks: number;
  clicks30: number;
  signups: number;
  /** Orders credited to the affiliate (voided ones excluded). */
  conversions: number;
  /** Conversions per click, percent. */
  conversionRate: number;
  totals: CurrencyTotals[];
  payable: { currency: string; amount: number }[];
}

interface StatsIndex {
  clicks: Map<string, AffiliateReferral[]>;
  signups: Map<string, number>;
  commissions: Map<string, Commission[]>;
}

/** Group clicks, referred sign-ups and commissions by affiliate in one pass. */
function indexStats(db: Pick<Database, "affiliateReferrals" | "analyticsEvents" | "commissions" | "users">): StatsIndex {
  const clicks = new Map<string, AffiliateReferral[]>();
  for (const r of db.affiliateReferrals) {
    const list = clicks.get(r.affiliateId) ?? [];
    list.push(r);
    clicks.set(r.affiliateId, list);
  }
  const created = new Map(db.users.map((u) => [u.id, Date.parse(u.createdAt)]));
  const signupPairs = new Set<string>();
  for (const e of db.analyticsEvents) {
    if (e.name !== REFERRAL_EVENT || !e.userId || !e.itemId) continue;
    const joined = created.get(e.userId);
    if (joined === undefined || joined + SIGNUP_SKEW_MS < Date.parse(e.createdAt)) continue;
    signupPairs.add(`${e.itemId}\u0000${e.userId}`);
  }
  const signups = new Map<string, number>();
  for (const pair of signupPairs) {
    const id = pair.split("\u0000")[0];
    signups.set(id, (signups.get(id) ?? 0) + 1);
  }
  const commissions = new Map<string, Commission[]>();
  for (const c of db.commissions) {
    const list = commissions.get(c.affiliateId) ?? [];
    list.push(c);
    commissions.set(c.affiliateId, list);
  }
  return { clicks, signups, commissions };
}

function statsFor(index: StatsIndex, affiliateId: string, now: number): AffiliateStats {
  const clicks = index.clicks.get(affiliateId) ?? [];
  const rows = index.commissions.get(affiliateId) ?? [];
  const conversions = new Set(rows.filter((c) => c.amount > 0 && c.status !== "void").map((c) => c.paymentId)).size;
  const since = now - 30 * DAY_MS;
  return {
    clicks: clicks.length,
    clicks30: clicks.filter((c) => Date.parse(c.createdAt) >= since).length,
    signups: index.signups.get(affiliateId) ?? 0,
    conversions,
    conversionRate: rate(conversions, clicks.length),
    totals: commissionTotals(rows),
    payable: payableBalances(rows),
  };
}

/** Successful sign-in IPs per member, for the members in `userIds`. */
function loginIps(db: Pick<Database, "loginEvents">, userIds: ReadonlySet<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of db.loginEvents) {
    if (!e.success || !e.userId || !e.ip || !userIds.has(e.userId)) continue;
    const set = out.get(e.userId) ?? new Set<string>();
    set.add(e.ip);
    out.set(e.userId, set);
  }
  return out;
}

/** Fraud flags for each commission (keyed by commission id). */
function flagCommissions(db: Database, rows: readonly Commission[]): Map<string, FraudFlag[]> {
  const affiliates = new Map(db.affiliates.map((a) => [a.id, a]));
  const payments = new Map(db.payments.map((p) => [p.id, p]));
  const users = new Map(db.users.map((u) => [u.id, u]));
  const involved = new Set<string>();
  for (const c of rows) {
    const a = affiliates.get(c.affiliateId);
    const p = payments.get(c.paymentId);
    if (a) involved.add(a.userId);
    if (p) involved.add(p.userId);
  }
  const ips = loginIps(db, involved);
  const out = new Map<string, FraudFlag[]>();
  for (const c of rows) {
    const a = affiliates.get(c.affiliateId);
    const p = payments.get(c.paymentId);
    if (!a || !p) continue;
    const flags = fraudFlags({
      buyerEmail: users.get(p.userId)?.email,
      buyerIps: ips.get(p.userId) ?? [],
      affiliateEmails: [users.get(a.userId)?.email, a.payoutEmail],
      affiliateIps: ips.get(a.userId) ?? new Set(),
    });
    if (flags.length) out.set(c.id, flags);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Learner dashboard                                                   */
/* ------------------------------------------------------------------ */

export interface AffiliateCommissionView {
  id: string;
  amount: number;
  currency: string;
  status: Commission["status"];
  createdAt: string;
  paidAt?: string;
  itemTitle: string;
  /** Negative correction after a refund. */
  adjustment: boolean;
}

export interface AffiliateDashboard {
  affiliate: Affiliate;
  stats: AffiliateStats;
  /** Clicks per day for the last 30 days (YYYY-MM-DD). */
  daily: { date: string; value: number }[];
  commissions: AffiliateCommissionView[];
  payouts: Payout[];
  topPages: { path: string; clicks: number; conversions: number }[];
}

export async function getAffiliateDashboard(userId: string, now: Date = new Date()): Promise<AffiliateDashboard | null> {
  const db = await getDb();
  const affiliate = db.affiliates.find((a) => a.userId === userId);
  if (!affiliate) return null;
  const index = indexStats(db);
  const stats = statsFor(index, affiliate.id, now.getTime());

  const clicks = index.clicks.get(affiliate.id) ?? [];
  const days: { date: string; value: number }[] = [];
  const byDay = new Map<string, number>();
  for (const c of clicks) {
    const key = toDateKey(new Date(c.createdAt));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  for (let i = 29; i >= 0; i--) {
    const key = toDateKey(new Date(now.getTime() - i * DAY_MS));
    days.push({ date: key, value: byDay.get(key) ?? 0 });
  }

  const pages = new Map<string, { clicks: number; conversions: number }>();
  for (const c of clicks) {
    const entry = pages.get(c.landingPath) ?? { clicks: 0, conversions: 0 };
    entry.clicks++;
    if (c.convertedPaymentId) entry.conversions++;
    pages.set(c.landingPath, entry);
  }
  const topPages = [...pages.entries()]
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => b.clicks - a.clicks || a.path.localeCompare(b.path))
    .slice(0, 8);

  const payments = new Map(db.payments.map((p) => [p.id, p]));
  const commissions = (index.commissions.get(affiliate.id) ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency,
      status: c.status,
      createdAt: c.createdAt,
      paidAt: c.paidAt,
      itemTitle: payments.get(c.paymentId)?.itemTitle ?? "Order",
      adjustment: c.amount < 0,
    }));
  const payouts = db.payouts.filter((p) => p.affiliateId === affiliate.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { affiliate: { ...affiliate }, stats, daily: days, commissions, payouts, topPages };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminAffiliateRow {
  affiliate: Affiliate;
  user: { id: string; name: string; email: string; username: string; avatarUrl?: string } | null;
  stats: AffiliateStats;
  /** Unpaid commissions with a fraud signal. */
  flagged: number;
}

export interface AffiliateOverview {
  active: number;
  pending: number;
  paused: number;
  clicks30: number;
  conversions30: number;
  pendingTotals: { currency: string; amount: number }[];
  payableTotals: { currency: string; amount: number }[];
  paidTotals: { currency: string; amount: number }[];
  flaggedUnpaid: number;
}

/** Totals per currency, sorted by currency code (zero totals dropped). */
export function sumByCurrency(rows: readonly { currency: string; amount: number }[]): { currency: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return [...by.entries()].filter(([, amount]) => amount !== 0).map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function getAffiliateOverview(now: Date = new Date()): Promise<AffiliateOverview> {
  const db = await getDb();
  const since = now.getTime() - 30 * DAY_MS;
  const unpaid = db.commissions.filter((c) => c.status === "pending" || c.status === "approved");
  const flags = flagCommissions(db, unpaid);
  return {
    active: db.affiliates.filter((a) => a.status === "active").length,
    pending: db.affiliates.filter((a) => a.status === "pending").length,
    paused: db.affiliates.filter((a) => a.status === "paused").length,
    clicks30: db.affiliateReferrals.filter((r) => Date.parse(r.createdAt) >= since).length,
    conversions30: new Set(db.commissions.filter((c) => c.amount > 0 && c.status !== "void" && Date.parse(c.createdAt) >= since).map((c) => c.paymentId)).size,
    pendingTotals: sumByCurrency(db.commissions.filter((c) => c.status === "pending")),
    payableTotals: sumByCurrency(db.commissions.filter((c) => c.status === "approved")),
    paidTotals: sumByCurrency(db.payouts.filter((p) => p.affiliateId)),
    flaggedUnpaid: flags.size,
  };
}

function userView(u: User | undefined): AdminAffiliateRow["user"] {
  return u ? { id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl } : null;
}

/** Every affiliate with stats, matching the filter (newest first; pending applications on top). */
export async function listAffiliates(filter: Omit<AffiliateFilter, "page">, now: Date = new Date()): Promise<AdminAffiliateRow[]> {
  const db = await getDb();
  const index = indexStats(db);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const unpaidFlags = flagCommissions(
    db,
    db.commissions.filter((c) => c.status === "pending" || c.status === "approved"),
  );
  const flaggedBy = new Map<string, number>();
  for (const c of db.commissions) if (unpaidFlags.has(c.id)) flaggedBy.set(c.affiliateId, (flaggedBy.get(c.affiliateId) ?? 0) + 1);
  const q = filter.q.toLowerCase();
  return db.affiliates
    .filter((a) => filter.status === "all" || a.status === filter.status)
    .filter((a) => !filter.flagged || (flaggedBy.get(a.id) ?? 0) > 0)
    .filter((a) => {
      if (!q) return true;
      const u = users.get(a.userId);
      return [a.code, a.payoutEmail, u?.name, u?.email, u?.username].some((v) => v?.toLowerCase().includes(q));
    })
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({ affiliate: { ...a }, user: userView(users.get(a.userId)), stats: statsFor(index, a.id, now.getTime()), flagged: flaggedBy.get(a.id) ?? 0 }));
}

export async function getAdminAffiliate(id: string, now: Date = new Date()): Promise<AdminAffiliateRow | null> {
  const db = await getDb();
  const affiliate = db.affiliates.find((a) => a.id === id);
  if (!affiliate) return null;
  const index = indexStats(db);
  const unpaid = db.commissions.filter((c) => c.affiliateId === id && (c.status === "pending" || c.status === "approved"));
  const flagged = flagCommissions(db, unpaid).size;
  return { affiliate: { ...affiliate }, user: userView(db.users.find((u) => u.id === affiliate.userId)), stats: statsFor(index, id, now.getTime()), flagged };
}

/** Commissions matching the filter, newest first. */
export async function listCommissions(filter: Omit<CommissionFilter, "page">): Promise<CommissionRowView[]> {
  const db = await getDb();
  const affiliates = new Map(db.affiliates.map((a) => [a.id, a]));
  const users = new Map(db.users.map((u) => [u.id, u]));
  const payments = new Map(db.payments.map((p) => [p.id, p]));
  const q = filter.q.toLowerCase();
  const candidates = db.commissions.filter((c) => {
    if (filter.status !== "all" && c.status !== filter.status) return false;
    if (filter.affiliateId && c.affiliateId !== filter.affiliateId) return false;
    const day = c.createdAt.slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    return true;
  });
  const flags = flagCommissions(db, candidates);
  return candidates
    .filter((c) => !filter.flagged || flags.has(c.id))
    .map((c): CommissionRowView => {
      const a = affiliates.get(c.affiliateId);
      const p = payments.get(c.paymentId);
      const buyer = p ? users.get(p.userId) : undefined;
      return {
        id: c.id,
        status: c.status,
        amount: c.amount,
        currency: c.currency,
        createdAt: c.createdAt,
        paidAt: c.paidAt,
        affiliateId: c.affiliateId,
        affiliateCode: a?.code ?? "—",
        affiliateName: (a && users.get(a.userId)?.name) ?? "Former affiliate",
        orderId: p?.orderId ?? "—",
        itemTitle: p?.itemTitle ?? "Deleted order",
        buyerName: buyer?.name ?? p?.billingName ?? "—",
        buyerEmail: buyer?.email ?? "",
        orderAmount: p?.amount ?? 0,
        flags: flags.get(c.id) ?? [],
      };
    })
    .filter((r) => !q || [r.affiliateCode, r.affiliateName, r.orderId, r.itemTitle, r.buyerName, r.buyerEmail].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export interface AdminPayoutRow {
  payout: Payout;
  affiliateCode: string;
  affiliateName: string;
  payoutEmail?: string;
}

export async function listAffiliatePayouts(affiliateId?: string): Promise<AdminPayoutRow[]> {
  const db = await getDb();
  const affiliates = new Map(db.affiliates.map((a) => [a.id, a]));
  const users = new Map(db.users.map((u) => [u.id, u]));
  return db.payouts
    .filter((p) => p.affiliateId && (!affiliateId || p.affiliateId === affiliateId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const a = affiliates.get(p.affiliateId as string);
      return { payout: { ...p }, affiliateCode: a?.code ?? "—", affiliateName: (a && users.get(a.userId)?.name) ?? "Former affiliate", payoutEmail: a?.payoutEmail };
    });
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** A CSV cell: text (quoted and formula-neutralized by `csvCell`) or a number written as-is. */
type Cell = string | { readonly num: string };

/**
 * Money cell in major units. Kept numeric so a negative refund adjustment
 * stays a number in spreadsheets instead of being escaped like a formula.
 */
const decimal = (amount: number): Cell => ({ num: (amount / 100).toFixed(2) });

function toCsv(rows: readonly Cell[][]): string {
  return rows.map((row) => row.map((cell) => (typeof cell === "string" ? csvCell(cell) : cell.num)).join(",")).join("\r\n");
}

export function affiliatesToCsv(rows: readonly AdminAffiliateRow[]): string {
  const header = ["Code", "Name", "Email", "Payout email", "Status", "Commission %", "Clicks", "Sign-ups", "Sales", "Conversion %", "Currency", "Pending", "Approved (payable)", "Paid", "Flagged", "Joined"];
  const lines: Cell[][] = [header];
  for (const r of rows) {
    const totals = r.stats.totals.length ? r.stats.totals : [{ currency: "", pending: 0, approved: 0, paid: 0, voided: 0 }];
    for (const t of totals) {
      lines.push([
        r.affiliate.code,
        r.user?.name ?? "",
        r.user?.email ?? "",
        r.affiliate.payoutEmail ?? "",
        r.affiliate.status,
        String(r.affiliate.commissionPercent),
        String(r.stats.clicks),
        String(r.stats.signups),
        String(r.stats.conversions),
        String(r.stats.conversionRate),
        t.currency,
        decimal(t.pending),
        decimal(t.approved),
        decimal(t.paid),
        String(r.flagged),
        r.affiliate.createdAt.slice(0, 10),
      ]);
    }
  }
  return toCsv(lines);
}

export function commissionsToCsv(rows: readonly CommissionRowView[]): string {
  const header = ["Commission ID", "Date", "Status", "Affiliate code", "Affiliate", "Order ID", "Item", "Buyer", "Buyer email", "Order amount", "Commission", "Currency", "Paid at", "Flags"];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.id,
      r.createdAt.slice(0, 10),
      r.status,
      r.affiliateCode,
      r.affiliateName,
      r.orderId,
      r.itemTitle,
      r.buyerName,
      r.buyerEmail,
      decimal(r.orderAmount),
      decimal(r.amount),
      r.currency,
      r.paidAt?.slice(0, 10) ?? "",
      r.flags.join(" "),
    ]),
  ]);
}

export function payoutsToCsv(rows: readonly AdminPayoutRow[]): string {
  const header = ["Payout ID", "Date", "Affiliate code", "Affiliate", "Payout email", "Amount", "Currency", "Method", "Reference"];
  return toCsv([
    header,
    ...rows.map((r) => [r.payout.id, r.payout.createdAt.slice(0, 10), r.affiliateCode, r.affiliateName, r.payoutEmail ?? "", decimal(r.payout.amount), r.payout.currency, methodLabel(r.payout.method), r.payout.reference ?? ""]),
  ]);
}

/** An affiliate's own statement: commissions (newest first), then payouts. */
export function statementToCsv(dashboard: Pick<AffiliateDashboard, "commissions" | "payouts">): string {
  const header = ["Type", "Date", "Description", "Status", "Amount", "Currency", "Paid at", "Method", "Reference"];
  return toCsv([
    header,
    ...dashboard.commissions.map((c) => [
      c.adjustment ? "Refund adjustment" : "Commission",
      c.createdAt.slice(0, 10),
      c.itemTitle,
      c.status,
      decimal(c.amount),
      c.currency,
      c.paidAt?.slice(0, 10) ?? "",
      "",
      "",
    ]),
    ...dashboard.payouts.map((p) => ["Payout", p.createdAt.slice(0, 10), "Payout sent", "paid", decimal(p.amount), p.currency, p.createdAt.slice(0, 10), methodLabel(p.method), p.reference ?? ""]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Share targets                                                       */
/* ------------------------------------------------------------------ */

/** Pages an affiliate can link to: key pages, published courses and bundles. */
export async function getShareTargets(): Promise<ShareTargetGroup[]> {
  const db = await getDb();
  const g = db.settings.growth;
  const pages = [
    { label: "Home page", path: "/" },
    { label: "All courses", path: "/courses" },
  ];
  const bundles = g.bundlesEnabled ? db.bundles.filter((b) => b.published).sort((a, b) => a.title.localeCompare(b.title)) : [];
  if (g.subscriptionsEnabled && db.plans.some((p) => p.active)) pages.push({ label: "Membership plans", path: "/pricing" });
  if (bundles.length) pages.push({ label: "All bundles", path: "/bundles" });
  const courses = db.courses.filter((c) => c.published).sort((a, b) => a.title.localeCompare(b.title));
  const groups: ShareTargetGroup[] = [{ label: "Pages", items: pages }];
  if (courses.length) groups.push({ label: "Courses", items: courses.map((c) => ({ label: c.title, path: `/courses/${c.slug}` })) });
  if (bundles.length) groups.push({ label: "Bundles", items: bundles.map((b) => ({ label: b.title, path: `/bundles/${b.slug}` })) });
  return groups;
}

/** An affiliate's most recent referral clicks (landing page and whether they led to a sale). */
export async function listReferralClicks(affiliateId: string, limit = 20): Promise<{ total: number; rows: AffiliateReferral[] }> {
  const db = await getDb();
  const all = db.affiliateReferrals.filter((r) => r.affiliateId === affiliateId);
  const rows = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return { total: all.length, rows: rows.map((r) => ({ ...r })) };
}
