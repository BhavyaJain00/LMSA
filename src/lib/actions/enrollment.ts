"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Course } from "@/lib/types";
import { getCurrentUser, hasRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageCourse, getCourseBySlug, getEnrollment, getNextLesson, lessonHref } from "@/lib/data/courses";
import { getUserCourseCertificate } from "@/lib/data/catalog";
import { enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { assertPrerequisitesMet } from "@/lib/services/drip";
import { issueCertificate } from "@/lib/services/progress";
import { setFlash } from "@/lib/flash";
import { fd } from "@/lib/utils";

function revalidateCourse(slug: string) {
  revalidatePath("/courses");
  revalidatePath(`/courses/${slug}`);
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/**
 * Optional `next` field: a lesson of this same course ("/courses/<slug>/learn/<chapter>-<lesson>")
 * to return to after enrolling. Anything else is ignored.
 */
function lessonReturnPath(formData: FormData, course: Course): string | null {
  const next = fd(formData, "next");
  const prefix = `/courses/${course.slug}/learn/`;
  if (!next || !next.startsWith(prefix)) return null;
  return /^\d{1,4}-\d{1,4}$/.test(next.slice(prefix.length)) ? next : null;
}

async function courseFromForm(formData: FormData): Promise<Course | null> {
  const slug = fd(formData, "slug");
  if (!slug) return null;
  return getCourseBySlug(slug);
}

/**
 * Enroll the current user in a course they are allowed to join for free.
 *
 * Mirrors Frappe's LMS Enrollment.before_insert checks: duplicate, self
 * learning disabled, unpublished, upcoming and payment required, plus the
 * round-2 prerequisite gate (every prerequisite course completed). Guests are
 * sent to the login page (with a warning toast) and come back afterwards.
 * On success the learner lands on their first unlocked lesson (or the course
 * page when every lesson is still scheduled).
 */
export async function enrollAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const course = await courseFromForm(formData);
  if (!course) return { ok: false, error: "This course no longer exists." };

  const returnTo = lessonReturnPath(formData, course);
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("You need to login first to enroll for this course", "warning");
    redirect(`/login?next=${encodeURIComponent(returnTo ?? `/courses/${course.slug}`)}`);
  }

  const db = await getDb();
  if (!db.settings.features.courses) return { ok: false, error: "Courses are currently disabled on this platform." };

  const manager = canManageCourse(user, course);
  const privileged = hasRole(user, "moderator", "course_creator", "batch_evaluator");

  const existing = await getEnrollment(user.id, course.id);
  if (existing) {
    const next = await getNextLesson(course, user);
    await setFlash("You're already enrolled in this course", "info");
    redirect(returnTo ?? (next ? lessonHref(course.slug, next) : `/courses/${course.slug}`));
  }

  if (!course.published && !manager) return { ok: false, error: "You cannot enroll in an unpublished course." };
  if (course.upcoming && !manager) return { ok: false, error: "This course is not open for enrollment yet." };
  if (course.disableSelfLearning && !privileged) {
    return {
      ok: false,
      error: "You cannot enroll in this course as self-learning is disabled. Please contact the Administrator.",
    };
  }

  // Prerequisite courses must be completed first (course managers and learners who already paid are exempt).
  if (!manager) {
    const gate = await assertPrerequisitesMet(user.id, course.id);
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  let paymentId: string | undefined;
  if (course.paidCourse && course.price > 0 && !manager) {
    const payment = db.payments.find((p) => p.userId === user.id && p.itemType === "course" && p.itemId === course.id && p.status === "paid");
    if (!payment) return { ok: false, error: "You need to complete the payment for this course before enrolling." };
    paymentId = payment.id;
  }

  await enrollUserInCourse(user.id, course.id, { memberType: manager ? "staff" : "student", paymentId });
  revalidateCourse(course.slug);

  const next = await getNextLesson(course, user);
  await setFlash("You have been enrolled in this course", "success");
  redirect(returnTo ?? (next ? lessonHref(course.slug, next) : `/courses/${course.slug}`));
}

/**
 * Leave a self-enrolled course. Removes the enrollment together with lesson
 * progress and video watch history. Batch, paid and certified enrollments
 * cannot be removed here.
 */
export async function unenrollAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const course = await courseFromForm(formData);
  if (!course) return { ok: false, error: "This course no longer exists." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };

  const enrollment = await getEnrollment(user.id, course.id);
  if (!enrollment) return { ok: false, error: "You are not enrolled in this course." };
  if (enrollment.batchId) return { ok: false, error: "This enrollment came through a batch. Leave the batch to unenroll." };
  if (enrollment.paymentId) return { ok: false, error: "Paid enrollments cannot be removed. Contact support for a refund." };
  if (enrollment.certificateId) return { ok: false, error: "You have already earned a certificate for this course." };

  await unenrollUserFromCourse(user.id, course.id);
  revalidateCourse(course.slug);
  await setFlash(`You left ${course.title}`, "info");
  redirect(`/courses/${course.slug}`);
}

/**
 * Claim the free certificate of completion (enable_certification) once every
 * lesson is complete. Certificates are normally issued automatically on
 * completion; this covers courses finished before certification was enabled.
 */
export async function claimCertificateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const course = await courseFromForm(formData);
  if (!course) return { ok: false, error: "This course no longer exists." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };

  const db = await getDb();
  if (!db.settings.features.certifications) return { ok: false, error: "Certificates are disabled on this platform." };
  if (!course.enableCertification || course.paidCertificate) {
    return { ok: false, error: "This course does not issue a certificate of completion." };
  }

  const enrollment = await getEnrollment(user.id, course.id);
  if (!enrollment) return { ok: false, error: "You must be enrolled in this course." };

  const existing = await getUserCourseCertificate(user.id, course.id);
  if (existing) redirect(`/certificates/${existing.code}`);

  const totalLessons = db.lessons.filter((l) => l.courseId === course.id).length;
  const completed = db.progress.filter((p) => p.userId === user.id && p.courseId === course.id && p.status === "complete").length;
  if (totalLessons === 0 || completed < totalLessons) {
    return { ok: false, error: "Complete every lesson to get your certificate." };
  }

  const cert = await issueCertificate(user, course);
  revalidateCourse(course.slug);
  revalidatePath(`/certificates/${cert.code}`);
  await setFlash("Your certificate is ready", "success");
  redirect(`/certificates/${cert.code}`);
}
