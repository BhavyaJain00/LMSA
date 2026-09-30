import "server-only";
import type { Course, Database, Enrollment, MembershipPlan, Payment, Subscription, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isInstallmentOrder, planForCourse, planGrantsAccess, planOfPayment, type InstallmentPlan } from "./installments";
import { planCoversCourse } from "./plans";
import { isOngoing, subscriptionGrantsAccess } from "./subscriptions";

/**
 * Course access resolution for commerce (round 3 wave B).
 *
 * An enrollment is permanent access, with two exceptions that keep the
 * learner's progress but lock the lessons:
 *  - it was opened through a membership: lessons unlock only while a
 *    membership covering the course is running;
 *  - the course is being paid in installments: lessons unlock while the
 *    payment plan is on track (a part may be overdue by up to 7 days) and
 *    for good once every part is paid.
 * Another permanent right always wins: a purchase of the course paid in
 * full, a paid bundle that includes it, or a seat in a batch that includes it.
 *
 * Both cases are recognised by the enrollment's `paymentId`: a membership
 * ("plan") order, or a part of a payment plan. Everything here is synchronous
 * over a database snapshot so it can run inside `mutate` and in synchronous
 * read models; the async `hasCourseAccess` wrapper is for callers holding
 * only ids.
 *
 * Staff (course managers) always have access; that check needs the course
 * permission rules and is done by the callers that know the viewer's roles.
 */

type Snapshot = Pick<Database, "courses" | "enrollments" | "payments" | "subscriptions" | "plans" | "batches" | "batchEnrollments" | "bundles">;

export type CourseAccessVia = "free" | "enrollment" | "purchase" | "bundle" | "batch" | "membership" | "installments";
export type CourseAccessBlock = "not_enrolled" | "membership_lapsed" | "installment_overdue" | "installment_cancelled";

export interface MembershipMatch {
  subscription: Subscription;
  plan: MembershipPlan;
}

export interface CourseAccess {
  granted: boolean;
  via?: CourseAccessVia;
  /** Why access is missing (set when `granted` is false). */
  blocked?: CourseAccessBlock;
  enrollment: Enrollment | null;
  /** A running membership that covers the course, when there is one. */
  membership: MembershipMatch | null;
  /** The payment plan the enrollment is being paid with, whatever its state (for banners and pay links). */
  installments: InstallmentPlan | null;
}

export function isPaidCourse(course: Pick<Course, "paidCourse" | "price">): boolean {
  return course.paidCourse && course.price > 0;
}

/** The membership order an enrollment was opened with, if it was opened through a membership. */
export function membershipSource(db: Pick<Snapshot, "payments">, enrollment: Pick<Enrollment, "paymentId">): Payment | null {
  if (!enrollment.paymentId) return null;
  const source = db.payments.find((p) => p.id === enrollment.paymentId);
  return source && source.itemType === "plan" ? source : null;
}

/** Running memberships of a member (newest first) whose plan still exists. */
export function membershipsOf(db: Pick<Snapshot, "subscriptions" | "plans">, userId: string, now: number = Date.now()): MembershipMatch[] {
  const out: MembershipMatch[] = [];
  for (const subscription of db.subscriptions) {
    if (subscription.userId !== userId || !subscriptionGrantsAccess(subscription, now)) continue;
    const plan = db.plans.find((p) => p.id === subscription.planId);
    if (plan) out.push({ subscription, plan });
  }
  return out.sort((a, b) => b.subscription.createdAt.localeCompare(a.subscription.createdAt));
}

/** A running membership of `userId` that unlocks `courseId`. */
export function membershipFor(db: Pick<Snapshot, "subscriptions" | "plans">, userId: string, courseId: string, now: number = Date.now()): MembershipMatch | null {
  return membershipsOf(db, userId, now).find((m) => planCoversCourse(m.plan, courseId)) ?? null;
}

/**
 * The member's current membership for display and self-service: an ongoing
 * one first, else the most recent one that still grants access (a cancelled
 * membership running to its period end), else null.
 */
export function currentSubscription(db: Pick<Snapshot, "subscriptions">, userId: string, now: number = Date.now()): Subscription | null {
  const mine = db.subscriptions.filter((s) => s.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine.find((s) => isOngoing(s)) ?? mine.find((s) => subscriptionGrantsAccess(s, now)) ?? null;
}

/**
 * Access to the course that depends on nothing that can lapse: a purchase
 * paid in full (at once, or every part of a payment plan), a paid bundle
 * that includes the course, or a batch seat.
 */
function permanentRight(db: Snapshot, userId: string, courseId: string, now: number): CourseAccessVia | null {
  const orders = db.payments.filter((p) => p.userId === userId && p.status === "paid");
  const forCourse = orders.filter((p) => p.itemType === "course" && p.itemId === courseId);
  if (forCourse.some((p) => !isInstallmentOrder(p))) return "purchase";
  if (forCourse.length && planForCourse(db.payments, userId, courseId, now)?.status === "completed") return "purchase";
  if (orders.some((p) => p.itemType === "bundle" && db.bundles.some((b) => b.id === p.itemId && b.courseIds.includes(courseId)))) return "bundle";
  const inBatch = db.batchEnrollments.some((s) => s.userId === userId && db.batches.some((b) => b.id === s.batchId && b.courseIds.includes(courseId)));
  return inBatch ? "batch" : null;
}

/** The order an enrollment was opened with. */
function enrollmentSource(db: Pick<Snapshot, "payments">, enrollment: Pick<Enrollment, "paymentId">): Payment | null {
  return enrollment.paymentId ? (db.payments.find((p) => p.id === enrollment.paymentId) ?? null) : null;
}

/** Whether an existing enrollment unlocks its course's lessons at `now`. */
export function enrollmentGrantsAccess(db: Snapshot, enrollment: Enrollment, now: number = Date.now()): boolean {
  const course = db.courses.find((c) => c.id === enrollment.courseId);
  if (!course || !isPaidCourse(course)) return true;
  const source = enrollmentSource(db, enrollment);
  if (!source) return true;
  if (source.itemType !== "plan") {
    const installments = planOfPayment(db.payments, source, now);
    if (!installments || planGrantsAccess(installments)) return true;
  }
  return !!membershipFor(db, enrollment.userId, course.id, now) || !!permanentRight(db, enrollment.userId, course.id, now);
}

/**
 * Everything commerce knows about a member's access to a course (staff
 * excluded, see above).
 */
export function resolveCourseAccess(db: Snapshot, userId: string, courseId: string, now: number = Date.now()): CourseAccess {
  const enrollment = db.enrollments.find((e) => e.userId === userId && e.courseId === courseId) ?? null;
  const course = db.courses.find((c) => c.id === courseId);
  const membership = membershipFor(db, userId, courseId, now);
  if (!course) return { granted: false, blocked: "not_enrolled", enrollment, membership, installments: null };

  // Not enrolled yet: with a membership (`membership` set) the member can open the course without a checkout.
  if (!enrollment) return { granted: false, blocked: "not_enrolled", enrollment, membership, installments: null };
  if (!isPaidCourse(course)) return { granted: true, via: "free", enrollment, membership, installments: null };

  const source = enrollmentSource(db, enrollment);
  const viaMembership = source?.itemType === "plan";
  const installments = source && !viaMembership ? planOfPayment(db.payments, source, now) : null;
  if (!viaMembership && !installments) {
    return { granted: true, via: permanentRight(db, userId, courseId, now) ?? "enrollment", enrollment, membership, installments };
  }
  if (viaMembership && membership) return { granted: true, via: "membership", enrollment, membership, installments };
  const permanent = permanentRight(db, userId, courseId, now);
  if (permanent) return { granted: true, via: permanent, enrollment, membership, installments };
  if (installments && planGrantsAccess(installments)) return { granted: true, via: "installments", enrollment, membership, installments };
  // A running membership that covers the course also keeps a course bought in parts open.
  if (membership) return { granted: true, via: "membership", enrollment, membership, installments };
  if (installments) {
    return { granted: false, blocked: installments.status === "paused" ? "installment_overdue" : "installment_cancelled", enrollment, membership: null, installments };
  }
  return { granted: false, blocked: "membership_lapsed", enrollment, membership: null, installments };
}

/**
 * Which courses of a list the member already has for good (a free or paid
 * enrollment, a purchase, a bundle, a batch seat). Courses opened through a
 * membership or still being paid in installments do not count: buying them
 * again, e.g. in a bundle, makes them permanent.
 */
export function ownedCourseIds(db: Snapshot, userId: string, courseIds: readonly string[], now: number = Date.now()): string[] {
  return courseIds.filter((courseId) => {
    const access = resolveCourseAccess(db, userId, courseId, now);
    return access.granted && access.via !== "membership" && access.via !== "installments";
  });
}

/**
 * Whether `user` can open the lessons of `courseId` as far as enrollment and
 * payment go (drip schedules and prerequisites are separate). Staff who
 * manage the course are checked by the caller via `canManageCourse`.
 */
export async function hasCourseAccess(user: Pick<User, "id"> | null, courseId: string): Promise<boolean> {
  if (!user) return false;
  const db = await getDb();
  return resolveCourseAccess(db, user.id, courseId).granted;
}

/** The membership order to attach to an enrollment opened through `subscription` (its first order). */
export function membershipOrderFor(db: Pick<Snapshot, "payments">, subscription: Pick<Subscription, "id">): Payment | null {
  const orders = db.payments.filter((p) => p.itemType === "plan" && p.subscriptionId === subscription.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return orders.find((p) => p.status === "paid") ?? orders[0] ?? null;
}
