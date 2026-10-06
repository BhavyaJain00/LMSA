import "server-only";
import type { MembershipPlan, Payment, Subscription, SubscriptionStatus, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { retrieveStripeSubscription, stripeDashboardSubscriptionUrl } from "@/lib/payments/stripe";
import { isConfigured } from "@/lib/payments/gateway";
import { hasInvoice } from "@/lib/payments/invoice";
import { razorpayDashboardSubscriptionUrl } from "@/lib/payments/razorpay";
import { currentSubscription } from "./access";
import { changeTargets } from "./membership-service";
import { monthlyEquivalent, planSavingsPercent } from "./plans";
import {
  SUBSCRIPTION_STATUS_LABELS,
  isGatewayManaged,
  isOngoing,
  monthlyRecurringRevenue,
  nextChargeDate,
  subscriptionAccessUntil,
  trialEligible,
} from "./subscriptions";

/**
 * Read models for the membership pages: `/pricing`, `/settings/subscription`
 * and the admin plans & members screens (with CSV export).
 */

const GATEWAY_LABELS: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay", manual: "Manual payment", free: "Complimentary", none: "No payment gateway" };

export function membershipGatewayLabel(gateway: string): string {
  return GATEWAY_LABELS[gateway] ?? gateway;
}

/* ------------------------------------------------------------------ */
/* Pricing page                                                        */
/* ------------------------------------------------------------------ */

export interface PricingPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  interval: MembershipPlan["interval"];
  price: number;
  currency: string;
  trialDays: number;
  features: string[];
  accessLabel: string;
  /** Titles of the included courses (selected-course plans). */
  courseTitles: string[];
  savingsPercent: number;
}

export interface PricingData {
  enabled: boolean;
  plans: PricingPlan[];
  /** Published courses (for "every course" plans). */
  courseCount: number;
  viewer: {
    loggedIn: boolean;
    /** The viewer's running membership. */
    currentPlanId: string | null;
    currentStatus: SubscriptionStatus | null;
    trialEligible: boolean;
  };
}

export async function getPricingData(viewer: Pick<User, "id"> | null): Promise<PricingData> {
  const db = await getDb();
  const active = db.plans.filter((p) => p.active);
  const titles = new Map(db.courses.filter((c) => c.published).map((c) => [c.id, c.title]));
  const current = viewer ? currentSubscription(db, viewer.id) : null;
  const order: Record<MembershipPlan["interval"], number> = { month: 0, year: 1, one_time: 2 };
  const plans = active
    .slice()
    .sort((a, b) => order[a.interval] - order[b.interval] || a.price - b.price)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      interval: p.interval,
      price: p.price,
      currency: p.currency,
      trialDays: p.trialDays,
      features: p.features,
      accessLabel: p.access.type === "all" ? "Every course" : `${p.access.courseIds.filter((id) => titles.has(id)).length} courses`,
      courseTitles: p.access.type === "courses" ? p.access.courseIds.map((id) => titles.get(id)).filter((t): t is string => !!t) : [],
      savingsPercent: planSavingsPercent(p, active),
    }));
  return {
    enabled: db.settings.growth.subscriptionsEnabled,
    plans,
    courseCount: titles.size,
    viewer: {
      loggedIn: !!viewer,
      currentPlanId: current && isOngoing(current) ? current.planId : null,
      currentStatus: current?.status ?? null,
      trialEligible: viewer ? trialEligible(db.subscriptions.filter((s) => s.userId === viewer.id)) : true,
    },
  };
}

/** Cheapest active monthly-equivalent plan covering a course (for "or join from $X/month"). */
export async function cheapestPlanFor(courseId: string): Promise<MembershipPlan | null> {
  const db = await getDb();
  if (!db.settings.growth.subscriptionsEnabled) return null;
  const covering = db.plans.filter((p) => p.active && (p.access.type === "all" || p.access.courseIds.includes(courseId)) && p.interval !== "one_time");
  if (!covering.length) return null;
  return covering.reduce((best, p) => (monthlyEquivalent(p) < monthlyEquivalent(best) ? p : best));
}

/* ------------------------------------------------------------------ */
/* Member: /settings/subscription                                      */
/* ------------------------------------------------------------------ */

export interface MembershipInvoiceRow {
  id: string;
  orderId: string;
  invoiceNumber?: string;
  title: string;
  amount: number;
  currency: string;
  status: Payment["status"];
  createdAt: string;
  paidAt?: string;
  invoiceHref: string | null;
  orderHref: string;
}

export interface MemberMembershipView {
  subscription: Subscription;
  plan: MembershipPlan | null;
  statusLabel: string;
  lifetime: boolean;
  gatewayLabel: string;
  gatewayManaged: boolean;
  /** When the member is charged next (null when nothing renews). */
  nextChargeAt: string | null;
  /** Last day of access (period end, or the grace end while a payment is due). */
  accessUntil: string | null;
  canCancel: boolean;
  canResume: boolean;
  /** Why resuming is not offered (Razorpay cannot undo a scheduled cancellation). */
  resumeNote?: string;
  changeTargets: { id: string; name: string; price: number; currency: string; interval: MembershipPlan["interval"] }[];
  /** Plan the membership moves to at its next renewal (a scheduled change), when there is one. */
  pendingPlan: { id: string; name: string; price: number; currency: string; interval: MembershipPlan["interval"] } | null;
  /** How a plan change is settled: right away with proration (Stripe), or at the next renewal. */
  changeBilling: "stripe" | "razorpay" | "manual";
  /** Unpaid renewal order of a membership managed here. */
  renewalOrder: { orderId: string; amount: number; currency: string } | null;
  /** Offer "Renew now" (a past-due or ending manual membership without an open renewal order). */
  canRenew: boolean;
  /** Stripe's hosted page to pay the failed invoice / update the card (past due only). */
  paymentUpdateUrl: string | null;
  courses: { title: string; slug: string }[] | "all";
}

export interface MemberMembershipPage {
  current: MemberMembershipView | null;
  history: { id: string; planName: string; status: SubscriptionStatus; statusLabel: string; startedAt: string; endedAt: string }[];
  invoices: MembershipInvoiceRow[];
  plansAvailable: number;
}

async function stripePaymentUpdateUrl(sub: Subscription): Promise<string | null> {
  if (sub.gateway !== "stripe" || !sub.gatewaySubscriptionId || sub.status !== "past_due" || !isConfigured("stripe")) return null;
  try {
    const live = await retrieveStripeSubscription(sub.gatewaySubscriptionId, { timeoutMs: 6_000 });
    const url = live.latestInvoice?.hostedInvoiceUrl;
    return url && /^https:\/\/invoice\.stripe\.com\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function getMemberMembership(userId: string): Promise<MemberMembershipPage> {
  const db = await getDb();
  const now = Date.now();
  const plans = new Map(db.plans.map((p) => [p.id, p]));
  const current = currentSubscription(db, userId, now);
  const courses = db.courses.filter((c) => c.published);

  let view: MemberMembershipView | null = null;
  if (current) {
    const plan = plans.get(current.planId) ?? null;
    const lifetime = plan?.interval === "one_time";
    const managed = isGatewayManaged(current);
    const until = subscriptionAccessUntil(current);
    const open = db.payments.find((p) => p.subscriptionId === current.id && p.itemType === "plan" && p.status === "pending");
    const ongoing = isOngoing(current);
    view = {
      subscription: { ...current },
      plan,
      statusLabel: current.cancelAtPeriodEnd && ongoing ? "Ends soon" : SUBSCRIPTION_STATUS_LABELS[current.status],
      lifetime,
      gatewayLabel: membershipGatewayLabel(current.gateway),
      gatewayManaged: managed,
      nextChargeAt: nextChargeDate(current, plan),
      accessUntil: lifetime ? null : current.status === "past_due" && until !== null ? new Date(until).toISOString() : until !== null ? current.currentPeriodEnd : null,
      canCancel: ongoing && !current.cancelAtPeriodEnd && !lifetime,
      canResume: ongoing && current.cancelAtPeriodEnd && !(managed && current.gateway === "razorpay"),
      resumeNote: ongoing && current.cancelAtPeriodEnd && managed && current.gateway === "razorpay" ? "Razorpay can't undo a scheduled cancellation. You can join again after it ends." : undefined,
      changeTargets: ongoing ? changeTargets(db.plans, plan, current.pendingPlanId).map((p) => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, interval: p.interval })) : [],
      pendingPlan: (() => {
        const next = ongoing && current.pendingPlanId ? plans.get(current.pendingPlanId) : undefined;
        return next ? { id: next.id, name: next.name, price: next.price, currency: next.currency, interval: next.interval } : null;
      })(),
      changeBilling: managed ? (current.gateway === "stripe" ? "stripe" : "razorpay") : "manual",
      renewalOrder: open && !managed ? { orderId: open.orderId, amount: open.amount, currency: open.currency } : null,
      canRenew: !managed && !lifetime && !open && !current.cancelAtPeriodEnd && (current.status === "past_due" || current.status === "active"),
      paymentUpdateUrl: await stripePaymentUpdateUrl(current),
      courses:
        plan?.access.type === "courses"
          ? plan.access.courseIds.map((id) => courses.find((c) => c.id === id)).filter((c): c is (typeof courses)[number] => !!c).map((c) => ({ title: c.title, slug: c.slug }))
          : "all",
    };
  }

  const history = db.subscriptions
    .filter((s) => s.userId === userId && s.id !== current?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({
      id: s.id,
      planName: plans.get(s.planId)?.name ?? "Retired plan",
      status: s.status,
      statusLabel: SUBSCRIPTION_STATUS_LABELS[s.status],
      startedAt: s.createdAt,
      endedAt: s.currentPeriodEnd,
    }));

  const invoices = db.payments
    .filter((p) => p.userId === userId && p.itemType === "plan" && p.status !== "failed")
    .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt))
    .map((p) => ({
      id: p.id,
      orderId: p.orderId,
      invoiceNumber: p.invoiceNumber,
      title: p.itemTitle,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      invoiceHref: hasInvoice(p) && p.invoiceNumber ? `/billing/invoice/${encodeURIComponent(p.orderId)}` : null,
      orderHref: `/billing/success/${encodeURIComponent(p.orderId)}`,
    }));

  return { current: view, history, invoices, plansAvailable: db.plans.filter((p) => p.active).length };
}

/* ------------------------------------------------------------------ */
/* Admin: plans and members                                            */
/* ------------------------------------------------------------------ */

export interface AdminPlanRow extends MembershipPlan {
  activeMembers: number;
  trialing: number;
  totalMembers: number;
  courseTitles: string[];
}

export interface MembershipStats {
  active: number;
  trialing: number;
  pastDue: number;
  endingSoon: number;
  /** Monthly recurring revenue per currency (paying members). */
  mrr: Record<string, number>;
}

export async function getAdminPlans(): Promise<{ plans: AdminPlanRow[]; stats: MembershipStats; courses: { id: string; title: string; published: boolean }[] }> {
  const db = await getDb();
  const titles = new Map(db.courses.map((c) => [c.id, c.title]));
  const plans = db.plans
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map((p) => {
      const subs = db.subscriptions.filter((s) => s.planId === p.id);
      return {
        ...p,
        activeMembers: subs.filter((s) => s.status === "active" || s.status === "past_due").length,
        trialing: subs.filter((s) => s.status === "trialing").length,
        totalMembers: subs.length,
        courseTitles: p.access.type === "courses" ? p.access.courseIds.map((id) => titles.get(id) ?? "Deleted course") : [],
      };
    });
  return {
    plans,
    stats: membershipStats(db.subscriptions, db.plans),
    courses: db.courses.map((c) => ({ id: c.id, title: c.title, published: c.published })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function membershipStats(subs: readonly Subscription[], plans: readonly MembershipPlan[], now: number = Date.now()): MembershipStats {
  const soon = now + 7 * 86_400_000;
  return {
    active: subs.filter((s) => s.status === "active").length,
    trialing: subs.filter((s) => s.status === "trialing").length,
    pastDue: subs.filter((s) => s.status === "past_due").length,
    endingSoon: subs.filter((s) => isOngoing(s) && s.cancelAtPeriodEnd && Date.parse(s.currentPeriodEnd) <= soon).length,
    mrr: monthlyRecurringRevenue(subs, plans),
  };
}

export type MemberStatusFilter = SubscriptionStatus | "all" | "ongoing" | "ending";

export interface MemberFilter {
  status: MemberStatusFilter;
  planId?: string;
  gateway?: string;
  search?: string;
  page: number;
}

export const MEMBERS_PAGE_SIZE = 25;

export interface AdminMemberRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  username: string | null;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  statusLabel: string;
  cancelAtPeriodEnd: boolean;
  gateway: string;
  gatewayLabel: string;
  gatewayManaged: boolean;
  gatewaySubscriptionId?: string;
  dashboardUrl: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  /** Paid membership orders (renewals included). */
  paidOrders: number;
  lifetimeValue: number;
  currency: string;
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function param(sp: SearchParamsRecord | URLSearchParams, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

const STATUS_FILTERS: readonly MemberStatusFilter[] = ["all", "ongoing", "ending", "trialing", "active", "past_due", "cancelled", "expired"];

export function parseMemberFilter(sp: SearchParamsRecord | URLSearchParams): MemberFilter {
  const status = param(sp, "status") as MemberStatusFilter;
  const page = Number.parseInt(param(sp, "page"), 10);
  return {
    status: STATUS_FILTERS.includes(status) ? status : "ongoing",
    planId: param(sp, "plan") || undefined,
    gateway: param(sp, "gateway") || undefined,
    search: param(sp, "q").trim().slice(0, 100) || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export async function getAdminMembers(filter: MemberFilter, opts: { all?: boolean } = {}): Promise<{ rows: AdminMemberRow[]; total: number; pageCount: number; page: number }> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const plans = new Map(db.plans.map((p) => [p.id, p]));
  const q = filter.search?.toLowerCase();
  const matched = db.subscriptions
    .filter((s) => {
      if (filter.status === "ongoing" && !isOngoing(s)) return false;
      if (filter.status === "ending" && !(isOngoing(s) && s.cancelAtPeriodEnd)) return false;
      if (filter.status !== "all" && filter.status !== "ongoing" && filter.status !== "ending" && s.status !== filter.status) return false;
      if (filter.planId && s.planId !== filter.planId) return false;
      if (filter.gateway && s.gateway !== filter.gateway) return false;
      if (q) {
        const u = users.get(s.userId);
        const hay = `${u?.name ?? ""} ${u?.email ?? ""} ${u?.username ?? ""} ${plans.get(s.planId)?.name ?? ""} ${s.gatewaySubscriptionId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pageCount = Math.max(1, Math.ceil(matched.length / MEMBERS_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const slice = opts.all ? matched : matched.slice((page - 1) * MEMBERS_PAGE_SIZE, page * MEMBERS_PAGE_SIZE);
  const rows = slice.map((s): AdminMemberRow => {
    const u = users.get(s.userId);
    const plan = plans.get(s.planId);
    const paid = db.payments.filter((p) => p.subscriptionId === s.id && p.status === "paid");
    const managed = isGatewayManaged(s);
    return {
      id: s.id,
      userId: s.userId,
      userName: u?.name ?? "Deleted member",
      userEmail: u?.email ?? "",
      username: u?.username ?? null,
      planId: s.planId,
      planName: plan?.name ?? "Retired plan",
      status: s.status,
      statusLabel: isOngoing(s) && s.cancelAtPeriodEnd ? "Ends at period end" : SUBSCRIPTION_STATUS_LABELS[s.status],
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      gateway: s.gateway,
      gatewayLabel: membershipGatewayLabel(s.gateway),
      gatewayManaged: managed,
      gatewaySubscriptionId: s.gatewaySubscriptionId,
      dashboardUrl: managed ? (s.gateway === "stripe" ? stripeDashboardSubscriptionUrl(s.gatewaySubscriptionId!) : razorpayDashboardSubscriptionUrl(s.gatewaySubscriptionId!)) : null,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      createdAt: s.createdAt,
      paidOrders: paid.filter((p) => p.amount > 0).length,
      lifetimeValue: paid.reduce((sum, p) => sum + p.amount - Math.min(p.amount, p.refundedAmount ?? 0), 0),
      currency: plan?.currency ?? paid[0]?.currency ?? "USD",
    };
  });
  return { rows, total: matched.length, pageCount, page };
}

export function membersToCsv(rows: AdminMemberRow[]): string {
  const header = ["Member", "Email", "Plan", "Status", "Ends at period end", "Billing", "Gateway subscription", "Period start", "Period end", "Joined", "Paid orders", "Amount paid", "Currency"];
  const money = (cents: number) => (cents / 100).toFixed(2);
  return toCsv([
    header,
    ...rows.map((r) => [
      r.userName,
      r.userEmail,
      r.planName,
      r.statusLabel,
      r.cancelAtPeriodEnd ? "Yes" : "No",
      r.gatewayLabel,
      r.gatewaySubscriptionId ?? "",
      r.currentPeriodStart,
      r.currentPeriodEnd,
      r.createdAt,
      String(r.paidOrders),
      money(r.lifetimeValue),
      r.currency,
    ]),
  ]);
}
