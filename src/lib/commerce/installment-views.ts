import "server-only";
import type { Course, CourseInstallmentPlan, Payment, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { paginate } from "./bundles";
import {
  INSTALLMENT_PLAN_STATUS_LABELS,
  installmentOffer,
  installmentPlans,
  isInstallmentOrder,
  isValidInstallmentPlan,
  offeredInstallmentPlan,
  planOfPayment,
  type InstallmentOffer,
  type InstallmentPartStatus,
  type InstallmentPlan,
  type InstallmentPlanStatus,
} from "./installments";

/**
 * Read models for payment plans: the learner's plan card (order page, order
 * history, course page), the "or N payments of X" offer, and the admin
 * installments tab (running plans, per-course terms, CSV export).
 */

const GATEWAY_LABELS: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay", manual: "Manual payment", free: "Waived", none: "No payment gateway" };

/* ------------------------------------------------------------------ */
/* Learner                                                             */
/* ------------------------------------------------------------------ */

export interface InstallmentPartView {
  number: number;
  orderId: string;
  amount: number;
  dueAt: string | null;
  paidAt?: string;
  status: InstallmentPartStatus;
  invoiceNumber?: string;
  /** The part the learner pays next. */
  isNext: boolean;
}

/** A payment plan as shown to its learner (plain data: safe to pass to client components). */
export interface InstallmentPlanView {
  /** Order id of the first payment. */
  key: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string | null;
  currency: string;
  total: number;
  paidCount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: InstallmentPlanStatus;
  statusLabel: string;
  parts: InstallmentPartView[];
  next: InstallmentPartView | null;
  overdueDays: number;
  /** When access pauses (or paused) while the next part stays unpaid. */
  pausesAt: string | null;
  /** Stripe charges the remaining parts by itself. */
  autoCharge: boolean;
  /** The gateway the next part is paid through: "stripe", "razorpay" or "manual". */
  payGateway: string;
  /** How the next part is paid ("Stripe", "Manual payment", …). */
  gatewayLabel: string;
}

function baseTitle(payment: Pick<Payment, "itemTitle">): string {
  return payment.itemTitle.replace(/ · payment \d+ of \d+$/, "");
}

/**
 * `platformGateway` is the active payment gateway: a part that is not charged
 * automatically is paid through it, whatever gateway the plan started with
 * (see `payInstallment`).
 */
export function toPlanView(plan: InstallmentPlan, course: Pick<Course, "title" | "slug"> | null | undefined, platformGateway: string): InstallmentPlanView {
  const parts: InstallmentPartView[] = plan.parts.map((p) => ({
    number: p.number,
    orderId: p.orderId,
    amount: p.amount,
    dueAt: p.dueAt,
    paidAt: p.paidAt,
    status: p.status,
    invoiceNumber: p.payment?.invoiceNumber,
    isNext: !!plan.next && plan.next.number === p.number,
  }));
  const payGateway = plan.autoCharge ? "stripe" : platformGateway === "none" ? "manual" : platformGateway;
  return {
    key: plan.key,
    courseId: plan.courseId,
    courseTitle: course?.title ?? baseTitle(plan.anchor),
    courseSlug: course?.slug ?? null,
    currency: plan.currency,
    total: plan.total,
    paidCount: plan.paidCount,
    paidAmount: plan.paidAmount,
    outstandingAmount: plan.outstandingAmount,
    status: plan.status,
    statusLabel: INSTALLMENT_PLAN_STATUS_LABELS[plan.status],
    parts,
    next: parts.find((p) => p.isNext) ?? null,
    overdueDays: plan.overdueDays,
    pausesAt: plan.pausesAt,
    autoCharge: plan.autoCharge,
    payGateway,
    gatewayLabel: GATEWAY_LABELS[payGateway] ?? payGateway,
  };
}

/** The plan an order belongs to, for its order page (null for orders that are not installments). */
export async function getPlanViewForOrder(payment: Payment): Promise<InstallmentPlanView | null> {
  if (!isInstallmentOrder(payment)) return null;
  const db = await getDb();
  const plan = planOfPayment(db.payments, payment);
  return plan ? toPlanView(plan, db.courses.find((c) => c.id === plan.courseId), db.settings.commerce.paymentGateway) : null;
}

/** A learner's plans that were started, the ones needing attention first. */
export async function getMyInstallmentPlans(userId: string): Promise<InstallmentPlanView[]> {
  const db = await getDb();
  const mine = db.payments.filter((p) => p.userId === userId && isInstallmentOrder(p));
  if (!mine.length) return [];
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const rank: Record<InstallmentPlanStatus, number> = { paused: 0, overdue: 1, on_track: 2, awaiting_first: 3, completed: 4, cancelled: 5 };
  return installmentPlans(mine)
    .filter((plan) => plan.status !== "awaiting_first")
    .sort((a, b) => rank[a.status] - rank[b.status])
    .map((plan) => toPlanView(plan, courses.get(plan.courseId), db.settings.commerce.paymentGateway));
}

/** "or N payments of X" for a course at its list price, or null when it is not sold in installments right now. */
export async function getInstallmentOffer(course: Pick<Course, "paidCourse" | "price" | "currency" | "installments">): Promise<InstallmentOffer | null> {
  const db = await getDb();
  const plan = offeredInstallmentPlan(course, { enabled: db.settings.growth.installmentsEnabled, gateway: db.settings.commerce.paymentGateway });
  return plan ? installmentOffer(course.price, course.currency || "USD", plan) : null;
}

/* ------------------------------------------------------------------ */
/* Admin: running plans                                                */
/* ------------------------------------------------------------------ */

export type InstallmentStatusFilter = InstallmentPlanStatus | "open" | "all";

export interface InstallmentFilter {
  status: InstallmentStatusFilter;
  courseId?: string;
  search?: string;
  page: number;
}

export const INSTALLMENTS_PAGE_SIZE = 25;

const STATUSES: readonly InstallmentPlanStatus[] = ["awaiting_first", "on_track", "overdue", "paused", "completed", "cancelled"];

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function param(sp: SearchParamsRecord | URLSearchParams, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

/** Filters of the admin installments tab (`istatus`, `icourse`, `iq`, `ipage`: the page shares its URL with other tabs). */
export function parseInstallmentFilter(sp: SearchParamsRecord | URLSearchParams): InstallmentFilter {
  const status = param(sp, "istatus");
  const page = Number(param(sp, "ipage"));
  return {
    status: status === "all" || (STATUSES as readonly string[]).includes(status) ? (status as InstallmentStatusFilter) : "open",
    courseId: param(sp, "icourse") || undefined,
    search: param(sp, "iq").trim().slice(0, 100) || undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export interface AdminInstallmentRow {
  key: string;
  userId: string;
  userName: string;
  userEmail: string;
  courseId: string;
  courseTitle: string;
  status: InstallmentPlanStatus;
  statusLabel: string;
  total: number;
  paidCount: number;
  partAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  currency: string;
  nextNumber: number | null;
  nextOrderId: string | null;
  nextDueAt: string | null;
  overdueDays: number;
  pausesAt: string | null;
  autoCharge: boolean;
  gatewayLabel: string;
  startedAt: string;
}

export interface InstallmentStats {
  /** Every plan, whatever its status. */
  total: number;
  /** Plans still collecting payments. */
  open: number;
  overdue: number;
  paused: number;
  completed: number;
  /** Still to be collected on open plans, per currency. */
  outstanding: { currency: string; amount: number }[];
}

function isOpen(status: InstallmentPlanStatus): boolean {
  return status === "on_track" || status === "overdue" || status === "paused";
}

function adminRow(plan: InstallmentPlan, user: Pick<User, "name" | "email"> | undefined, course: Pick<Course, "title"> | undefined): AdminInstallmentRow {
  const gateway = plan.next?.payment?.gateway ?? plan.anchor.gateway;
  return {
    key: plan.key,
    userId: plan.userId,
    userName: user?.name ?? plan.anchor.billingName,
    userEmail: user?.email ?? "",
    courseId: plan.courseId,
    courseTitle: course?.title ?? baseTitle(plan.anchor),
    status: plan.status,
    statusLabel: INSTALLMENT_PLAN_STATUS_LABELS[plan.status],
    total: plan.total,
    paidCount: plan.paidCount,
    partAmount: plan.anchor.amount,
    paidAmount: plan.paidAmount,
    outstandingAmount: plan.outstandingAmount,
    currency: plan.currency,
    nextNumber: plan.next?.number ?? null,
    nextOrderId: plan.next?.orderId ?? null,
    nextDueAt: plan.next?.dueAt ?? null,
    overdueDays: plan.overdueDays,
    pausesAt: plan.pausesAt,
    autoCharge: plan.autoCharge,
    gatewayLabel: plan.autoCharge ? "Stripe · automatic" : (GATEWAY_LABELS[gateway] ?? gateway),
    startedAt: plan.anchor.paidAt ?? plan.anchor.createdAt,
  };
}

export function installmentStats(plans: readonly Pick<InstallmentPlan, "status" | "outstandingAmount" | "currency">[]): InstallmentStats {
  const outstanding = new Map<string, number>();
  let open = 0;
  let overdue = 0;
  let paused = 0;
  let completed = 0;
  for (const plan of plans) {
    if (plan.status === "completed") completed++;
    if (!isOpen(plan.status)) continue;
    open++;
    if (plan.status === "overdue") overdue++;
    if (plan.status === "paused") paused++;
    if (plan.outstandingAmount > 0) outstanding.set(plan.currency, (outstanding.get(plan.currency) ?? 0) + plan.outstandingAmount);
  }
  return { total: plans.length, open, overdue, paused, completed, outstanding: Array.from(outstanding, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount) };
}

/** Payment plans for the admin tab: filtered, the most urgent first, paged; with overall stats. */
export async function getAdminInstallments(
  filter: InstallmentFilter,
  opts: { all?: boolean } = {},
): Promise<{ rows: AdminInstallmentRow[]; total: number; page: number; pageCount: number; stats: InstallmentStats; courses: { id: string; title: string }[] }> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const plans = installmentPlans(db.payments);
  const q = filter.search?.toLowerCase();
  const urgency: Record<InstallmentPlanStatus, number> = { paused: 0, overdue: 1, on_track: 2, awaiting_first: 3, completed: 4, cancelled: 5 };

  const matched = plans
    .map((plan) => adminRow(plan, users.get(plan.userId), courses.get(plan.courseId)))
    .filter((row) => {
      if (filter.status === "open" ? !isOpen(row.status) : filter.status !== "all" && row.status !== filter.status) return false;
      if (filter.courseId && row.courseId !== filter.courseId) return false;
      if (q && !`${row.userName} ${row.userEmail} ${row.courseTitle} ${row.key}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => urgency[a.status] - urgency[b.status] || (a.nextDueAt ?? "9").localeCompare(b.nextDueAt ?? "9") || b.startedAt.localeCompare(a.startedAt));
  const paged = paginate(matched, filter.page, INSTALLMENTS_PAGE_SIZE);
  const withPlans = [...new Set(plans.map((p) => p.courseId))].map((id) => ({ id, title: courses.get(id)?.title ?? "Deleted course" })).sort((a, b) => a.title.localeCompare(b.title));
  return { rows: opts.all ? matched : paged.rows, total: paged.total, page: paged.page, pageCount: paged.pageCount, stats: installmentStats(plans), courses: withPlans };
}

export function installmentsToCsv(rows: readonly AdminInstallmentRow[]): string {
  const money = (amount: number) => (amount / 100).toFixed(2);
  return toCsv([
    ["Order", "Learner", "Email", "Course", "Status", "Payments made", "Payments in plan", "Each payment", "Paid so far", "Outstanding", "Currency", "Next payment", "Next due", "Days overdue", "Collected by", "Started"],
    ...rows.map((r) => [
      r.key,
      r.userName,
      r.userEmail,
      r.courseTitle,
      r.statusLabel,
      String(r.paidCount),
      String(r.total),
      money(r.partAmount),
      money(r.paidAmount),
      money(r.outstandingAmount),
      r.currency,
      r.nextNumber ? `${r.nextNumber} of ${r.total}` : "",
      r.nextDueAt ?? "",
      r.overdueDays ? String(r.overdueDays) : "",
      r.gatewayLabel,
      r.startedAt,
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Admin: which courses are sold in installments                       */
/* ------------------------------------------------------------------ */

export interface InstallmentCourseRow {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  price: number;
  currency: string;
  /** The course's terms (null when it is not sold in installments). */
  plan: CourseInstallmentPlan | null;
  /** What a learner pays with those terms at the list price. */
  offer: InstallmentOffer | null;
  /** Plans of this course still collecting payments. */
  openPlans: number;
}

/** Paid courses with their installment terms, the ones sold in installments first. */
export async function getInstallmentCourses(): Promise<InstallmentCourseRow[]> {
  const db = await getDb();
  const open = new Map<string, number>();
  for (const plan of installmentPlans(db.payments)) if (isOpen(plan.status)) open.set(plan.courseId, (open.get(plan.courseId) ?? 0) + 1);
  return db.courses
    .filter((c) => c.paidCourse && c.price > 0)
    .map((c) => {
      const plan = isValidInstallmentPlan(c.installments) ? c.installments : null;
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        published: c.published,
        price: c.price,
        currency: c.currency || "USD",
        plan,
        offer: plan ? installmentOffer(c.price, c.currency || "USD", plan) : null,
        openPlans: open.get(c.id) ?? 0,
      };
    })
    .sort((a, b) => Number(!!b.plan) - Number(!!a.plan) || a.title.localeCompare(b.title));
}
