import type { Earning, InstructorProfile, Payment } from "@/lib/types";
import { csvCell } from "@/components/admin/settings/member-import-csv";
import { commissionBase, methodLabel, pageParam, param, type SearchParamsLike } from "@/lib/growth/affiliates-shared";
import { isValidEmail } from "@/lib/utils";

/**
 * Instructor marketplace rules shared by the server, the `/teach` pages and
 * `/admin/marketplace` (no server imports: safe on the client and in tests).
 *
 * Money is always an integer in the smallest currency unit. Splits use the
 * largest-remainder method so the parts of an order add up exactly and no
 * cent is created or lost by rounding.
 */

export const MARKETPLACE_LIMITS = {
  bioMin: 80,
  bioMax: 4000,
  expertiseMax: 10,
  expertiseItemMax: 40,
  sampleMax: 4000,
  urlMax: 500,
  emailMax: 200,
  reasonMax: 1000,
  referenceMax: 120,
} as const;

export const MARKETPLACE_PAGE_SIZE = 25;

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

/** What an applicant tells us (stored as JSON in `InstructorProfile.application`). */
export interface InstructorApplication {
  bio: string;
  expertise: string[];
  /** Link to a sample lesson, video or portfolio. */
  sampleUrl?: string;
  /** Sample lesson outline or teaching sample, as text. */
  sample?: string;
}

export function serializeApplication(app: InstructorApplication): string {
  return JSON.stringify({ v: 1, bio: app.bio, expertise: app.expertise, sampleUrl: app.sampleUrl || undefined, sample: app.sample || undefined });
}

/** Read a stored application; plain text from older rows becomes the bio. */
export function parseApplication(raw: string | undefined): InstructorApplication {
  if (!raw) return { bio: "", expertise: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "bio" in value) {
      const v = value as Record<string, unknown>;
      return {
        bio: typeof v.bio === "string" ? v.bio : "",
        expertise: Array.isArray(v.expertise) ? v.expertise.filter((x): x is string => typeof x === "string") : [],
        sampleUrl: typeof v.sampleUrl === "string" && v.sampleUrl ? v.sampleUrl : undefined,
        sample: typeof v.sample === "string" && v.sample ? v.sample : undefined,
      };
    }
  } catch {
    // Not JSON: an application written as plain text.
  }
  return { bio: raw, expertise: [] };
}

/** "React, TypeScript\nUX" -> ["React", "TypeScript", "UX"] (trimmed, de-duplicated case-insensitively). */
export function parseExpertise(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export interface ApplicationInput {
  bio: string;
  expertise: string;
  sampleUrl: string;
  sample: string;
  payoutEmail: string;
}

export type ApplicationValidation =
  | { ok: true; application: InstructorApplication; payoutEmail: string }
  | { ok: false; errors: Partial<Record<keyof ApplicationInput, string>> };

export function validateApplication(input: ApplicationInput): ApplicationValidation {
  const L = MARKETPLACE_LIMITS;
  const bio = input.bio.trim();
  const expertise = parseExpertise(input.expertise);
  const sampleUrl = input.sampleUrl.trim();
  const sample = input.sample.trim();
  const payoutEmail = input.payoutEmail.trim().toLowerCase();
  const errors: Partial<Record<keyof ApplicationInput, string>> = {};

  if (bio.length < L.bioMin) errors.bio = `Tell us a little more about yourself (at least ${L.bioMin} characters).`;
  else if (bio.length > L.bioMax) errors.bio = `Keep your bio under ${L.bioMax} characters.`;
  if (!expertise.length) errors.expertise = "Add at least one subject you can teach.";
  else if (expertise.length > L.expertiseMax) errors.expertise = `List at most ${L.expertiseMax} subjects.`;
  else if (expertise.some((t) => t.length > L.expertiseItemMax)) errors.expertise = `Keep each subject under ${L.expertiseItemMax} characters.`;
  if (sampleUrl && (sampleUrl.length > L.urlMax || !isHttpUrl(sampleUrl))) errors.sampleUrl = "Enter a full link starting with https://.";
  if (sample.length > L.sampleMax) errors.sample = `Keep the sample under ${L.sampleMax} characters.`;
  if (!sampleUrl && !sample) errors.sample = "Share a sample of your teaching: a link or a short lesson outline.";
  if (!payoutEmail) errors.payoutEmail = "Enter the email address we should send payouts to.";
  else if (payoutEmail.length > L.emailMax || !isValidEmail(payoutEmail)) errors.payoutEmail = "Enter a valid email address.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, application: { bio, expertise, sampleUrl: sampleUrl || undefined, sample: sample || undefined }, payoutEmail };
}

/** A revenue share percentage in 0..100 with at most two decimals, or null when the input is not one. */
export function parseSharePercent(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

export const APPLICATION_STATUS_LABELS: Record<InstructorProfile["status"], string> = {
  applied: "Awaiting review",
  approved: "Approved",
  rejected: "Not approved",
};

/* ------------------------------------------------------------------ */
/* Revenue split                                                       */
/* ------------------------------------------------------------------ */

/**
 * Split the integer `total` in proportion to `weights` so the parts add up
 * to exactly `total` (largest remainder; ties go to the earlier entry).
 * All-zero weights split evenly.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const amount = Math.max(0, Math.round(total));
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((s, w) => s + w, 0);
  const basis = sum > 0 ? clean : clean.map(() => 1);
  const basisSum = sum > 0 ? sum : n;
  const exact = basis.map((w) => (amount * w) / basisSum);
  const parts = exact.map((x) => Math.floor(x));
  let left = amount - parts.reduce((s, p) => s + p, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k].i]++;
  return parts;
}

/** Net order amount instructors share: the price paid after discounts, excluding tax. */
export function orderNet(payment: Pick<Payment, "amount" | "taxAmount">): number {
  return commissionBase(payment);
}

/** Share `net` among the courses of an order in proportion to their list prices. */
export function allocateToCourses(net: number, courses: readonly { id: string; weight: number }[]): { courseId: string; amount: number }[] {
  const parts = largestRemainder(net, courses.map((c) => c.weight));
  return courses.map((c, i) => ({ courseId: c.id, amount: parts[i] }));
}

export interface InstructorShareInput {
  instructorId: string;
  /** Revenue share in percent (0..100). */
  percent: number;
}

/**
 * Instructor earnings for one course's net revenue: the course is split
 * evenly among its approved instructors and each receives their share
 * percentage of their part. The total paid to instructors is the exact sum
 * rounded once; the platform keeps the rest. Zero amounts are dropped.
 */
export function splitCourseRevenue(courseNet: number, instructors: readonly InstructorShareInput[]): { instructorId: string; amount: number }[] {
  const unique = instructors.filter((x, i, all) => all.findIndex((y) => y.instructorId === x.instructorId) === i);
  if (!unique.length || !(courseNet > 0)) return [];
  const exact = unique.map((x) => (Math.round(courseNet) * Math.min(100, Math.max(0, x.percent))) / 100 / unique.length);
  const total = Math.round(exact.reduce((s, x) => s + x, 0));
  const parts = largestRemainder(total, exact);
  return unique.map((x, i) => ({ instructorId: x.instructorId, amount: parts[i] })).filter((x) => x.amount > 0);
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

type EarningLike = Pick<Earning, "id" | "share" | "status" | "createdAt">;

export interface EarningRefundPlan {
  /** Unpaid rows to void. */
  voidIds: string[];
  /** Negative pending correction to add (deducted from the next payout), or null. */
  adjustment: number | null;
}

/**
 * How a refund changes one instructor's earnings for one course of an
 * order: the share shrinks in proportion to the refunded amount. Unpaid
 * earnings of a full refund are voided; anything already paid (or a partial
 * refund) produces a negative correction.
 */
export function planEarningRefund(rows: readonly EarningLike[], order: { amount: number; refundedAmount: number; full: boolean }): EarningRefundPlan {
  const none: EarningRefundPlan = { voidIds: [], adjustment: null };
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const original = sorted.find((r) => r.share > 0);
  if (!original || original.status === "void") return none;
  const live = sorted.filter((r) => r.status !== "void");
  const current = live.reduce((s, r) => s + r.share, 0);
  const refunded = Math.min(Math.max(0, order.refundedAmount), order.amount);
  const remaining = order.full || order.amount <= 0 ? 0 : (order.amount - refunded) / order.amount;
  const target = Math.round(original.share * remaining);
  if (target >= current) return none;
  const anyPaid = live.some((r) => r.status === "paid");
  if (!anyPaid && target === 0) return { voidIds: live.map((r) => r.id), adjustment: null };
  return { voidIds: [], adjustment: target - current };
}

/* ------------------------------------------------------------------ */
/* Totals and reports                                                  */
/* ------------------------------------------------------------------ */

type TotalsRow = Pick<Earning, "share" | "currency" | "status">;

export interface EarningTotals {
  currency: string;
  /** Unpaid balance (refund corrections included). */
  pending: number;
  paid: number;
  voided: number;
}

export function earningTotals(rows: readonly TotalsRow[]): EarningTotals[] {
  const by = new Map<string, EarningTotals>();
  for (const r of rows) {
    const t = by.get(r.currency) ?? { currency: r.currency, pending: 0, paid: 0, voided: 0 };
    if (r.status === "pending") t.pending += r.share;
    else if (r.status === "paid") t.paid += r.share;
    else t.voided += r.share;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Positive unpaid balances per currency (what a payout would send). */
export function pendingBalances(rows: readonly TotalsRow[]): { currency: string; amount: number }[] {
  return earningTotals(rows)
    .filter((t) => t.pending > 0)
    .map((t) => ({ currency: t.currency, amount: t.pending }));
}

type ReportRow = Pick<Earning, "courseId" | "share" | "gross" | "currency" | "status" | "createdAt">;

export interface CourseEarningSummary {
  courseId: string;
  currency: string;
  /** Sales counted (original, non-void earnings). */
  sales: number;
  /** Net revenue attributed to the instructor's earnings (non-void originals). */
  gross: number;
  pending: number;
  paid: number;
}

export function earningsByCourse(rows: readonly ReportRow[]): CourseEarningSummary[] {
  const by = new Map<string, CourseEarningSummary>();
  for (const r of rows) {
    const key = `${r.courseId}\u0000${r.currency}`;
    const s = by.get(key) ?? { courseId: r.courseId, currency: r.currency, sales: 0, gross: 0, pending: 0, paid: 0 };
    if (r.status !== "void" && r.share > 0) {
      s.sales++;
      s.gross += r.gross;
    }
    if (r.status === "pending") s.pending += r.share;
    else if (r.status === "paid") s.paid += r.share;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.pending + b.paid - (a.pending + a.paid) || a.courseId.localeCompare(b.courseId));
}

export interface MonthEarningSummary {
  /** YYYY-MM (UTC). */
  month: string;
  currency: string;
  sales: number;
  /** Earned in the month, net of refund corrections (void rows excluded). */
  earned: number;
}

export function earningsByMonth(rows: readonly ReportRow[]): MonthEarningSummary[] {
  const by = new Map<string, MonthEarningSummary>();
  for (const r of rows) {
    if (r.status === "void") continue;
    const month = r.createdAt.slice(0, 7);
    const key = `${month}\u0000${r.currency}`;
    const s = by.get(key) ?? { month, currency: r.currency, sales: 0, earned: 0 };
    if (r.share > 0) s.sales++;
    s.earned += r.share;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency));
}

/** "2026-09" -> "Sep 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export const APPLICATION_STATUSES = ["applied", "approved", "rejected"] as const;
export const EARNING_STATUSES = ["pending", "paid", "void"] as const;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ApplicationFilter {
  status: InstructorProfile["status"] | "all";
  q: string;
  page: number;
}

export function parseApplicationFilter(sp: SearchParamsLike): ApplicationFilter {
  const status = param(sp, "status");
  return {
    status: (APPLICATION_STATUSES as readonly string[]).includes(status) ? (status as InstructorProfile["status"]) : "all",
    q: param(sp, "q").trim().slice(0, 120),
    page: pageParam(sp),
  };
}

export interface EarningFilter {
  status: Earning["status"] | "all";
  q: string;
  courseId: string;
  instructorId: string;
  /** Inclusive YYYY-MM-DD bounds (UTC) on the earning date. */
  from: string;
  to: string;
  page: number;
}

export function parseEarningFilter(sp: SearchParamsLike): EarningFilter {
  const status = param(sp, "status");
  const from = param(sp, "from");
  const to = param(sp, "to");
  return {
    status: (EARNING_STATUSES as readonly string[]).includes(status) ? (status as Earning["status"]) : "all",
    q: param(sp, "q").trim().slice(0, 120),
    courseId: ID.test(param(sp, "course")) ? param(sp, "course") : "",
    instructorId: ID.test(param(sp, "instructor")) ? param(sp, "instructor") : "",
    from: DAY_KEY.test(from) ? from : "",
    to: DAY_KEY.test(to) ? to : "",
    page: pageParam(sp),
  };
}

export function isEarningFilterActive(f: EarningFilter): boolean {
  return f.status !== "all" || !!f.q || !!f.courseId || !!f.instructorId || !!f.from || !!f.to;
}

/** Query string of a filter (defaults omitted), e.g. for export links. */
export function earningFilterQuery(f: EarningFilter, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams(extra);
  if (f.status !== "all") qs.set("status", f.status);
  if (f.q) qs.set("q", f.q);
  if (f.courseId) qs.set("course", f.courseId);
  if (f.instructorId) qs.set("instructor", f.instructorId);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  return qs.toString();
}

/** An earning as listed to instructors and administrators. */
export interface EarningRowView {
  id: string;
  createdAt: string;
  status: Earning["status"];
  instructorId: string;
  instructorName: string;
  courseId: string;
  courseTitle: string;
  orderId: string;
  /** Negative refund correction. */
  adjustment: boolean;
  gross: number;
  share: number;
  currency: string;
  paidAt?: string;
}

export function filterEarningRows<T extends EarningRowView>(rows: readonly T[], f: EarningFilter): T[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) => {
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.courseId && r.courseId !== f.courseId) return false;
    if (f.instructorId && r.instructorId !== f.instructorId) return false;
    const day = r.createdAt.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q && !`${r.courseTitle} ${r.instructorName} ${r.orderId}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** A CSV cell: text (quoted and formula-neutralized) or a number written as-is. */
type Cell = string | { readonly num: string };
const decimal = (amount: number): Cell => ({ num: (amount / 100).toFixed(2) });

function toCsv(rows: readonly Cell[][]): string {
  return rows.map((row) => row.map((cell) => (typeof cell === "string" ? csvCell(cell) : cell.num)).join(",")).join("\r\n");
}

/** Earnings report; `withInstructor` adds the instructor column (admin export). */
export function earningsToCsv(rows: readonly EarningRowView[], withInstructor: boolean): string {
  const header = ["Earning ID", "Date", "Type", "Status", ...(withInstructor ? ["Instructor"] : []), "Course", "Order ID", "Net sale", withInstructor ? "Instructor share" : "Your share", "Currency", "Paid at"];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.id,
      r.createdAt.slice(0, 10),
      r.adjustment ? "Refund adjustment" : "Sale",
      r.status,
      ...(withInstructor ? [r.instructorName] : []),
      r.courseTitle,
      r.orderId,
      decimal(r.adjustment ? 0 : r.gross),
      decimal(r.share),
      r.currency,
      r.paidAt?.slice(0, 10) ?? "",
    ]),
  ]);
}

export interface PayoutRowView {
  id: string;
  createdAt: string;
  instructorId: string;
  instructorName: string;
  payTo: string;
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  /** Earnings rows settled by the payout. */
  earnings: number;
}

export function payoutsToCsv(rows: readonly PayoutRowView[]): string {
  const header = ["Payout ID", "Date", "Instructor", "Payout email", "Amount", "Currency", "Method", "Reference", "Earnings settled"];
  return toCsv([
    header,
    ...rows.map((r) => [r.id, r.createdAt.slice(0, 10), r.instructorName, r.payTo, decimal(r.amount), r.currency, methodLabel(r.method), r.reference ?? "", { num: String(r.earnings) }]),
  ]);
}
