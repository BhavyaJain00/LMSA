import "server-only";
import type { Course, Database, Enrollment, MembershipPlan, Payment, Subscription, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { planCoversCourse } from "./plans";
import { isOngoing, subscriptionGrantsAccess } from "./subscriptions";

/**
 * Course access resolution for commerce (round 3 wave B).
 *
 * An enrollment is permanent access, except when it was opened through a
 * membership: those enrollments keep the learner's progress but only unlock
 * lessons while a membership covering the course is running (or while
 * another permanent right exists — a purchase of the course or a seat in a
 * batch that includes it).
 *
 * A membership enrollment is recognised by its `paymentId` pointing at a
 * membership ("plan") order. Everything here is synchronous over a database
 * snapshot so it can run inside `mutate` and in synchronous read models; the
 * async `hasCourseAccess` wrapper is for callers holding only ids.
 *
 * Staff (course managers) always have access; that check needs the course
 * permission rules and is done by the callers that know the viewer's roles.
 */

type Snapshot = Pick<Database, "courses" | "enrollments" | "payments" | "subscriptions" | "plans" | "batches" | "batchEnrollments">;

export type CourseAccessVia = "free" | "enrollment" | "purchase" | "batch" | "membership";
export type CourseAccessBlock = "not_enrolled" | "membership_lapsed";

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

/** Access to the course that does not depend on a membership (a purchase or a batch seat). */
function permanentRight(db: Snapshot, userId: string, courseId: string): CourseAccessVia | null {
  if (db.payments.some((p) => p.userId === userId && p.itemType === "course" && p.itemId === courseId && p.status === "paid")) return "purchase";
  const inBatch = db.batchEnrollments.some((s) => s.userId === userId && db.batches.some((b) => b.id === s.batchId && b.courseIds.includes(courseId)));
  return inBatch ? "batch" : null;
}

/** Whether an existing enrollment unlocks its course's lessons at `now`. */
export function enrollmentGrantsAccess(db: Snapshot, enrollment: Enrollment, now: number = Date.now()): boolean {
  const course = db.courses.find((c) => c.id === enrollment.courseId);
  if (!course || !isPaidCourse(course)) return true;
  if (!membershipSource(db, enrollment)) return true;
  return !!membershipFor(db, enrollment.userId, course.id, now) || !!permanentRight(db, enrollment.userId, course.id);
}

/**
 * Everything commerce knows about a member's access to a course (staff
 * excluded, see above).
 */
export function resolveCourseAccess(db: Snapshot, userId: string, courseId: string, now: number = Date.now()): CourseAccess {
  const enrollment = db.enrollments.find((e) => e.userId === userId && e.courseId === courseId) ?? null;
  const course = db.courses.find((c) => c.id === courseId);
  const membership = membershipFor(db, userId, courseId, now);
  if (!course) return { granted: false, blocked: "not_enrolled", enrollment, membership };

  // Not enrolled yet: with a membership (`membership` set) the member can open the course without a checkout.
  if (!enrollment) return { granted: false, blocked: "not_enrolled", enrollment, membership };
  if (!isPaidCourse(course)) return { granted: true, via: "free", enrollment, membership };
  if (!membershipSource(db, enrollment)) {
    const permanent = permanentRight(db, userId, courseId);
    return { granted: true, via: permanent ?? "enrollment", enrollment, membership };
  }
  if (membership) return { granted: true, via: "membership", enrollment, membership };
  const permanent = permanentRight(db, userId, courseId);
  if (permanent) return { granted: true, via: permanent, enrollment, membership };
  return { granted: false, blocked: "membership_lapsed", enrollment, membership: null };
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
