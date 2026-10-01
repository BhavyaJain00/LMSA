import "server-only";
import type { Course, Database, Earning, InstructorProfile, Payment, Payout, User } from "@/lib/types";
import type { DomainEventMap } from "@/lib/events";
import { getDb, mutate } from "@/lib/db/store";
import { notify, notifyMany } from "@/lib/services/notifications";
import { formatPrice, uid } from "@/lib/utils";
import { methodLabel } from "@/lib/growth/affiliates-shared";
import {
  allocateToCourses,
  earningTotals,
  earningsByCourse,
  earningsByMonth,
  filterEarningRows,
  orderNet,
  parseApplication,
  pendingBalances,
  planEarningRefund,
  serializeApplication,
  splitCourseRevenue,
  type ApplicationFilter,
  type CourseEarningSummary,
  type EarningFilter,
  type EarningRowView,
  type EarningTotals,
  type InstructorApplication,
  type MonthEarningSummary,
  type PayoutRowView,
} from "./marketplace-shared";

/**
 * Instructor marketplace on the server (teaching tools): applications from
 * `/teach`, review in `/admin/marketplace`, instructor earnings credited on
 * `payment.paid` and corrected on `payment.refunded`, payouts, and the read
 * models behind `/teach/earnings` and the admin tabs.
 *
 * Earnings are created for courses only (a course order, a bundle or a gift
 * of either): the net order amount is allocated to its courses by list price,
 * then shared among each course's approved marketplace instructors.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function profileOf(db: Pick<Database, "instructorProfiles">, userId: string): InstructorProfile | undefined {
  return db.instructorProfiles.find((p) => p.userId === userId);
}

export async function getInstructorProfile(userId: string): Promise<InstructorProfile | null> {
  const db = await getDb();
  const profile = profileOf(db, userId);
  return profile ? { ...profile } : null;
}

function adminIds(db: Pick<Database, "users">): string[] {
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

/** Courses an order pays for, weighted by list price (for splitting a bundle). */
function coursesOfOrder(db: Database, payment: Payment): Course[] {
  let itemType: string = payment.itemType;
  let itemId = payment.itemId;
  if (itemType === "gift") {
    const gift = db.gifts.find((g) => g.id === payment.itemId);
    if (!gift) return [];
    itemType = gift.itemType;
    itemId = gift.itemId;
  }
  const ids = itemType === "course" ? [itemId] : itemType === "bundle" ? (db.bundles.find((b) => b.id === itemId)?.courseIds ?? []) : [];
  return ids.map((id) => db.courses.find((c) => c.id === id)).filter((c): c is Course => !!c);
}

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

export type ApplyResult = { ok: true; profile: InstructorProfile; created: boolean; resubmitted: boolean } | { ok: false; error: string };

/**
 * Create or update the caller's application. A pending application can be
 * edited; a rejected one is resubmitted for review; approved instructors
 * cannot apply again.
 */
export async function submitInstructorApplication(user: Pick<User, "id" | "name">, application: InstructorApplication, payoutEmail: string): Promise<ApplyResult> {
  const result = await mutate((d): ApplyResult => {
    const m = d.settings.marketplace;
    if (!m.enabled || !m.allowApplications) return { ok: false, error: "We aren't accepting instructor applications right now." };
    const now = new Date().toISOString();
    const existing = profileOf(d, user.id);
    if (existing?.status === "approved") return { ok: false, error: "You are already an approved instructor." };
    if (existing) {
      const resubmitted = existing.status === "rejected";
      existing.application = serializeApplication(application);
      existing.payoutEmail = payoutEmail;
      existing.status = "applied";
      if (resubmitted) {
        existing.rejectionReason = undefined;
        existing.reviewedAt = undefined;
        existing.createdAt = now;
      }
      return { ok: true, profile: { ...existing }, created: false, resubmitted };
    }
    const profile: InstructorProfile = {
      id: uid("inst"),
      userId: user.id,
      revenueSharePercent: m.defaultRevenueSharePercent,
      status: "applied",
      application: serializeApplication(application),
      payoutEmail,
      createdAt: now,
    };
    d.instructorProfiles.push(profile);
    return { ok: true, profile: { ...profile }, created: true, resubmitted: false };
  });
  if (result.ok && (result.created || result.resubmitted)) {
    const db = await getDb();
    await notifyMany(adminIds(db), {
      type: "system",
      subject: `${user.name} applied to teach`,
      message: "Review the instructor application in the marketplace.",
      link: `/admin/marketplace/${result.profile.id}`,
      fromUserId: user.id,
      dedupeKey: `instructor-application:${result.profile.id}:${result.profile.createdAt}`,
    });
  }
  return result;
}

export type ReviewDecision = { decision: "approve"; sharePercent: number } | { decision: "reject"; reason: string };
export type ReviewResult =
  | { ok: true; profile: InstructorProfile; previous: InstructorProfile["status"]; roleGranted: boolean; userName: string }
  | { ok: false; error: string };

/**
 * Approve (with a revenue share; grants the course_creator role) or reject
 * (with a reason) an application. Approved instructors can also be moved to
 * rejected, which stops new earnings; earned money stays payable.
 */
export async function reviewInstructorApplication(adminId: string, profileId: string, review: ReviewDecision): Promise<ReviewResult> {
  const result = await mutate((d): ReviewResult => {
    const profile = d.instructorProfiles.find((p) => p.id === profileId);
    if (!profile) return { ok: false, error: "This application no longer exists." };
    const user = d.users.find((u) => u.id === profile.userId);
    if (!user) return { ok: false, error: "The applicant's account no longer exists." };
    const previous = profile.status;
    let roleGranted = false;
    profile.reviewedAt = new Date().toISOString();
    if (review.decision === "approve") {
      profile.status = "approved";
      profile.revenueSharePercent = review.sharePercent;
      profile.rejectionReason = undefined;
      if (!user.roles.includes("course_creator") && !user.roles.includes("admin")) {
        user.roles = [...user.roles, "course_creator"];
        roleGranted = true;
      }
    } else {
      profile.status = "rejected";
      profile.rejectionReason = review.reason;
    }
    return { ok: true, profile: { ...profile }, previous, roleGranted, userName: user.name };
  });
  if (!result.ok) return result;
  const p = result.profile;
  if (review.decision === "approve") {
    await notify(p.userId, {
      type: "system",
      subject: result.previous === "approved" ? "Your instructor terms were updated" : "You're approved to teach",
      message:
        result.previous === "approved"
          ? `Your revenue share is now ${p.revenueSharePercent}% of the net course revenue.`
          : `Welcome aboard! You can now create courses and you earn ${p.revenueSharePercent}% of the net revenue of the courses you teach.`,
      link: "/teach",
      fromUserId: adminId,
      dedupeKey: `instructor-review:${p.id}:${p.reviewedAt}`,
    });
  } else {
    await notify(p.userId, {
      type: "system",
      subject: result.previous === "approved" ? "Your instructor account was suspended" : "Your instructor application was not approved",
      message: p.rejectionReason,
      link: "/teach",
      fromUserId: adminId,
      dedupeKey: `instructor-review:${p.id}:${p.reviewedAt}`,
    });
  }
  return result;
}

export type TermsResult = { ok: true; before: Pick<InstructorProfile, "revenueSharePercent" | "payoutEmail">; profile: InstructorProfile } | { ok: false; error: string };

/** Change an instructor's revenue share (applies to new sales) and payout email. */
export async function updateInstructorTerms(profileId: string, terms: { sharePercent: number; payoutEmail: string | undefined }): Promise<TermsResult> {
  return mutate((d): TermsResult => {
    const profile = d.instructorProfiles.find((p) => p.id === profileId);
    if (!profile) return { ok: false, error: "This instructor no longer exists." };
    const before = { revenueSharePercent: profile.revenueSharePercent, payoutEmail: profile.payoutEmail };
    profile.revenueSharePercent = terms.sharePercent;
    profile.payoutEmail = terms.payoutEmail;
    return { ok: true, before, profile: { ...profile } };
  });
}

/** The instructor's own payout email. */
export async function setOwnPayoutEmail(userId: string, payoutEmail: string): Promise<InstructorProfile | null> {
  return mutate((d) => {
    const profile = profileOf(d, userId);
    if (!profile) return null;
    profile.payoutEmail = payoutEmail;
    return { ...profile };
  });
}

/* ------------------------------------------------------------------ */
/* Earnings                                                            */
/* ------------------------------------------------------------------ */

export type CreditEarningsResult =
  | { credited: true; earnings: Earning[] }
  | { credited: false; reason: "disabled" | "missing" | "not_paid" | "exists" | "no_courses" | "no_instructors" | "zero_amount" };

/**
 * Credit the approved instructors of the courses in a paid order. Idempotent
 * per order (a redelivered `payment.paid` creates nothing). The buyer never
 * earns from their own purchase.
 */
export async function creditEarnings(paymentId: string): Promise<CreditEarningsResult> {
  const result = await mutate((d): CreditEarningsResult & { titles?: Map<string, string> } => {
    if (!d.settings.marketplace.enabled) return { credited: false, reason: "disabled" };
    const payment = d.payments.find((p) => p.id === paymentId);
    if (!payment) return { credited: false, reason: "missing" };
    if (payment.status !== "paid") return { credited: false, reason: "not_paid" };
    if (d.earnings.some((e) => e.paymentId === payment.id)) return { credited: false, reason: "exists" };
    const net = orderNet(payment);
    if (net <= 0) return { credited: false, reason: "zero_amount" };
    const courses = coursesOfOrder(d, payment);
    if (!courses.length) return { credited: false, reason: "no_courses" };

    const now = new Date().toISOString();
    const rows: Earning[] = [];
    const titles = new Map<string, string>();
    for (const part of allocateToCourses(net, courses.map((c) => ({ id: c.id, weight: c.price })))) {
      const course = courses.find((c) => c.id === part.courseId);
      if (!course) continue;
      const instructors = course.instructorIds
        .filter((id) => id !== payment.userId)
        .map((id) => profileOf(d, id))
        .filter((p): p is InstructorProfile => p?.status === "approved")
        .map((p) => ({ instructorId: p.userId, percent: p.revenueSharePercent }));
      for (const split of splitCourseRevenue(part.amount, instructors)) {
        rows.push({
          id: uid("earn"),
          instructorId: split.instructorId,
          paymentId: payment.id,
          courseId: course.id,
          gross: part.amount,
          share: split.amount,
          currency: payment.currency,
          status: "pending",
          createdAt: now,
        });
        titles.set(course.id, course.title);
      }
    }
    if (!rows.length) return { credited: false, reason: "no_instructors" };
    d.earnings.push(...rows);
    return { credited: true, earnings: rows.map((r) => ({ ...r })), titles };
  });

  if (result.credited) {
    const byInstructor = new Map<string, Earning[]>();
    for (const e of result.earnings) byInstructor.set(e.instructorId, [...(byInstructor.get(e.instructorId) ?? []), e]);
    for (const [instructorId, rows] of byInstructor) {
      const amount = rows.reduce((s, r) => s + r.share, 0);
      const titles = rows.map((r) => result.titles?.get(r.courseId) ?? "a course");
      await notify(instructorId, {
        type: "system",
        subject: `You earned ${formatPrice(amount, rows[0].currency)} from a sale`,
        message: `A learner bought ${titles.join(", ")}. The amount is added to your next payout.`,
        link: "/teach/earnings",
        email: false,
        dedupeKey: `earning:${paymentId}:${instructorId}`,
      });
    }
    return { credited: true, earnings: result.earnings };
  }
  return result;
}

/**
 * Reduce or void instructor earnings of a refunded order (see
 * `planEarningRefund`), per instructor and course. Paid earnings are clawed
 * back with a negative pending row deducted from the next payout.
 */
export async function reverseEarningsForRefund(data: DomainEventMap["payment.refunded"]): Promise<{ voided: number; adjustments: Earning[] }> {
  const outcome = await mutate((d) => {
    const rows = d.earnings.filter((e) => e.paymentId === data.paymentId);
    if (!rows.length) return null;
    const groups = new Map<string, Earning[]>();
    for (const r of rows) {
      const key = `${r.instructorId}\u0000${r.courseId}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    let voided = 0;
    const adjustments: Earning[] = [];
    const touched = new Set<string>();
    const now = new Date().toISOString();
    for (const group of groups.values()) {
      const plan = planEarningRefund(group, { amount: data.amount, refundedAmount: data.refundedAmount, full: data.full });
      for (const id of plan.voidIds) {
        const row = d.earnings.find((e) => e.id === id);
        if (row) row.status = "void";
      }
      voided += plan.voidIds.length;
      if (plan.adjustment) {
        const original = group.find((r) => r.share > 0) ?? group[0];
        const adjustment: Earning = {
          id: uid("earn"),
          instructorId: original.instructorId,
          paymentId: data.paymentId,
          courseId: original.courseId,
          gross: 0,
          share: plan.adjustment,
          currency: original.currency,
          status: "pending",
          createdAt: now,
        };
        d.earnings.push(adjustment);
        adjustments.push({ ...adjustment });
      }
      if (plan.voidIds.length || plan.adjustment) touched.add(group[0].instructorId);
    }
    const payment = d.payments.find((p) => p.id === data.paymentId);
    return { voided, adjustments, touched: [...touched], itemTitle: payment?.itemTitle ?? "An order" };
  });
  if (!outcome) return { voided: 0, adjustments: [] };
  for (const instructorId of outcome.touched) {
    const deducted = outcome.adjustments.filter((a) => a.instructorId === instructorId);
    const amount = deducted.reduce((s, a) => s + a.share, 0);
    await notify(instructorId, {
      type: "system",
      subject: deducted.length ? "An earning was reduced after a refund" : "An earning was cancelled after a refund",
      message: deducted.length
        ? `${outcome.itemTitle} was refunded; ${formatPrice(-amount, deducted[0].currency)} is deducted from your next payout.`
        : `${outcome.itemTitle} was refunded, so its earning no longer applies.`,
      link: "/teach/earnings",
      email: false,
      dedupeKey: `earning-refund:${data.paymentId}:${data.refundedAmount}:${instructorId}`,
    });
  }
  return { voided: outcome.voided, adjustments: outcome.adjustments };
}

/* ------------------------------------------------------------------ */
/* Payouts                                                             */
/* ------------------------------------------------------------------ */

export interface PayoutRequest {
  instructorIds: string[];
  currency: string;
  method: string;
  reference?: string;
  /** Include sales up to this day (YYYY-MM-DD, UTC); refund corrections are always deducted. */
  through?: string;
}

export interface PayoutOutcome {
  payouts: Payout[];
  /** Instructors skipped because nothing was payable. */
  skipped: string[];
}

/** Pending earnings a payout settles: sales up to `through` plus every pending correction. */
export function payableRows(rows: readonly Earning[], instructorId: string, currency: string, through?: string): Earning[] {
  return rows.filter(
    (e) => e.instructorId === instructorId && e.currency === currency && e.status === "pending" && (e.share < 0 || !through || e.createdAt.slice(0, 10) <= through),
  );
}

/**
 * Pay each instructor's pending balance in one currency: their pending rows
 * become paid and a `Payout` of the net amount is recorded. Instructors with
 * no positive balance are skipped.
 */
export async function recordInstructorPayouts(adminId: string, request: PayoutRequest): Promise<PayoutOutcome> {
  const outcome = await mutate((d): PayoutOutcome => {
    const payouts: Payout[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();
    for (const instructorId of request.instructorIds) {
      const rows = payableRows(d.earnings, instructorId, request.currency, request.through);
      const amount = rows.reduce((s, r) => s + r.share, 0);
      if (!rows.length || amount <= 0) {
        skipped.push(instructorId);
        continue;
      }
      for (const row of rows) {
        row.status = "paid";
        row.paidAt = now;
      }
      const payout: Payout = { id: uid("pout"), instructorId, amount, currency: request.currency, method: request.method, reference: request.reference || undefined, createdAt: now };
      d.payouts.push(payout);
      payouts.push({ ...payout });
    }
    return { payouts, skipped };
  });
  for (const p of outcome.payouts) {
    if (!p.instructorId) continue;
    await notify(p.instructorId, {
      type: "system",
      subject: `Payout sent: ${formatPrice(p.amount, p.currency)}`,
      message: `Your course earnings were paid by ${methodLabel(p.method)}${p.reference ? ` (reference ${p.reference})` : ""}.`,
      link: "/teach/earnings?tab=payouts",
      fromUserId: adminId,
      dedupeKey: `instructor-payout:${p.id}`,
    });
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

function earningViews(db: Database, rows: readonly Earning[]): EarningRowView[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const payments = new Map(db.payments.map((p) => [p.id, p]));
  return rows
    .map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      status: e.status,
      instructorId: e.instructorId,
      instructorName: users.get(e.instructorId)?.name ?? "Deleted member",
      courseId: e.courseId,
      courseTitle: courses.get(e.courseId)?.title ?? "Deleted course",
      orderId: payments.get(e.paymentId)?.orderId ?? e.paymentId,
      adjustment: e.share < 0,
      gross: e.gross,
      share: e.share,
      currency: e.currency,
      paidAt: e.paidAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function payoutViews(db: Database, rows: readonly Payout[]): PayoutRowView[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  return rows
    .filter((p): p is Payout & { instructorId: string } => !!p.instructorId)
    .map((p) => {
      const user = users.get(p.instructorId);
      return {
        id: p.id,
        createdAt: p.createdAt,
        instructorId: p.instructorId,
        instructorName: user?.name ?? "Deleted member",
        payTo: profileOf(db, p.instructorId)?.payoutEmail ?? user?.email ?? "",
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        reference: p.reference,
        earnings: db.earnings.filter((e) => e.instructorId === p.instructorId && e.status === "paid" && e.paidAt === p.createdAt && e.currency === p.currency).length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export interface InstructorEarningsData {
  profile: InstructorProfile;
  totals: EarningTotals[];
  byCourse: (CourseEarningSummary & { courseTitle: string })[];
  byMonth: MonthEarningSummary[];
  /** Filtered rows (newest first). */
  rows: EarningRowView[];
  /** Every earning row count, before filtering. */
  totalRows: number;
  courses: { id: string; title: string }[];
  payouts: PayoutRowView[];
}

/** Everything `/teach/earnings` shows for one instructor, or null without a profile. */
export async function getInstructorEarnings(userId: string, filter: EarningFilter): Promise<InstructorEarningsData | null> {
  const db = await getDb();
  const profile = profileOf(db, userId);
  if (!profile) return null;
  const mine = db.earnings.filter((e) => e.instructorId === userId);
  const views = earningViews(db, mine);
  const titles = new Map(views.map((v) => [v.courseId, v.courseTitle]));
  return {
    profile: { ...profile },
    totals: earningTotals(mine),
    byCourse: earningsByCourse(mine).map((s) => ({ ...s, courseTitle: titles.get(s.courseId) ?? "Deleted course" })),
    byMonth: earningsByMonth(mine),
    rows: filterEarningRows(views, { ...filter, instructorId: "" }),
    totalRows: views.length,
    courses: [...titles].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
    payouts: payoutViews(
      db,
      db.payouts.filter((p) => p.instructorId === userId),
    ),
  };
}

export interface TeachPageData {
  profile: InstructorProfile | null;
  application: InstructorApplication | null;
  /** Courses the member teaches (any status). */
  courses: { id: string; slug: string; title: string; published: boolean }[];
  totals: EarningTotals[];
}

export async function getTeachPageData(userId: string): Promise<TeachPageData> {
  const db = await getDb();
  const profile = profileOf(db, userId);
  return {
    profile: profile ? { ...profile } : null,
    application: profile ? parseApplication(profile.application) : null,
    courses: db.courses
      .filter((c) => c.instructorIds.includes(userId))
      .map((c) => ({ id: c.id, slug: c.slug, title: c.title, published: c.published }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    totals: earningTotals(db.earnings.filter((e) => e.instructorId === userId)),
  };
}

/* ----- admin ----- */

export interface MarketplaceOverview {
  applied: number;
  approved: number;
  rejected: number;
  pendingTotals: { currency: string; amount: number }[];
  paidTotals: { currency: string; amount: number }[];
  /** Sales credited to instructors in the last 30 days. */
  sales30: number;
}

export async function getMarketplaceOverview(now: Date = new Date()): Promise<MarketplaceOverview> {
  const db = await getDb();
  const totals = earningTotals(db.earnings);
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    applied: db.instructorProfiles.filter((p) => p.status === "applied").length,
    approved: db.instructorProfiles.filter((p) => p.status === "approved").length,
    rejected: db.instructorProfiles.filter((p) => p.status === "rejected").length,
    pendingTotals: totals.filter((t) => t.pending !== 0).map((t) => ({ currency: t.currency, amount: t.pending })),
    paidTotals: totals.filter((t) => t.paid !== 0).map((t) => ({ currency: t.currency, amount: t.paid })),
    sales30: new Set(db.earnings.filter((e) => e.share > 0 && e.status !== "void" && e.createdAt >= since).map((e) => e.paymentId)).size,
  };
}

export interface InstructorRow {
  profile: InstructorProfile;
  application: InstructorApplication;
  user: { id: string; name: string; email: string; username: string; avatarUrl?: string } | null;
  courseCount: number;
  totals: EarningTotals[];
  /** Positive unpaid balances per currency. */
  balances: { currency: string; amount: number }[];
}

function instructorRow(db: Database, profile: InstructorProfile): InstructorRow {
  const user = db.users.find((u) => u.id === profile.userId);
  const rows = db.earnings.filter((e) => e.instructorId === profile.userId);
  return {
    profile: { ...profile },
    application: parseApplication(profile.application),
    user: user ? { id: user.id, name: user.name, email: user.email, username: user.username, avatarUrl: user.avatarUrl } : null,
    courseCount: db.courses.filter((c) => c.instructorIds.includes(profile.userId)).length,
    totals: earningTotals(rows),
    balances: pendingBalances(rows),
  };
}

/** Applications and instructors, newest first, pending reviews on top. */
export async function listInstructorProfiles(filter: Omit<ApplicationFilter, "page">): Promise<InstructorRow[]> {
  const db = await getDb();
  const q = filter.q.toLowerCase();
  const rank = { applied: 0, approved: 1, rejected: 2 } as const;
  return db.instructorProfiles
    .filter((p) => filter.status === "all" || p.status === filter.status)
    .map((p) => instructorRow(db, p))
    .filter((r) => !q || `${r.user?.name ?? ""} ${r.user?.email ?? ""} ${r.profile.payoutEmail ?? ""} ${r.application.expertise.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => rank[a.profile.status] - rank[b.profile.status] || b.profile.createdAt.localeCompare(a.profile.createdAt));
}

export async function getInstructorRow(profileId: string): Promise<InstructorRow | null> {
  const db = await getDb();
  const profile = db.instructorProfiles.find((p) => p.id === profileId);
  return profile ? instructorRow(db, profile) : null;
}

/** Approved or formerly approved instructors with a positive unpaid balance. */
export async function listPayableInstructors(): Promise<InstructorRow[]> {
  const db = await getDb();
  return db.instructorProfiles
    .map((p) => instructorRow(db, p))
    .filter((r) => r.balances.length > 0)
    .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? ""));
}

export async function listEarnings(filter: EarningFilter): Promise<EarningRowView[]> {
  const db = await getDb();
  return filterEarningRows(earningViews(db, db.earnings), filter);
}

export async function listInstructorPayouts(instructorId?: string): Promise<PayoutRowView[]> {
  const db = await getDb();
  return payoutViews(
    db,
    db.payouts.filter((p) => (instructorId ? p.instructorId === instructorId : !!p.instructorId)),
  );
}

/** Courses and instructors that appear in earnings (admin filter options). */
export async function getEarningFilterOptions(): Promise<{ courses: { id: string; title: string }[]; instructors: { id: string; name: string }[] }> {
  const db = await getDb();
  const courseIds = new Set(db.earnings.map((e) => e.courseId));
  const instructorIds = new Set(db.earnings.map((e) => e.instructorId));
  return {
    courses: db.courses.filter((c) => courseIds.has(c.id)).map((c) => ({ id: c.id, title: c.title })).sort((a, b) => a.title.localeCompare(b.title)),
    instructors: db.users.filter((u) => instructorIds.has(u.id)).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
