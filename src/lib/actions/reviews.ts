"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, Review } from "@/lib/types";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { findById, getDb, insert, remove, update } from "@/lib/db/store";
import { getCourseBySlug, getEnrollment } from "@/lib/data/courses";
import { notifyMany } from "@/lib/services/notifications";
import { fd, fdNumber, truncate, uid } from "@/lib/utils";

const MAX_REVIEW_LENGTH = 2000;

type Rating = Review["rating"];

function parseRating(n: number): Rating | null {
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n as Rating;
}

function revalidateCourse(course: Pick<Course, "slug">) {
  revalidatePath(`/courses/${course.slug}`);
  revalidatePath("/courses");
  revalidatePath("/");
}

/** Validate rating + text; returns field errors keyed by input name. */
function validateReview(formData: FormData): { rating: Rating | null; text: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const rating = parseRating(fdNumber(formData, "rating", 0));
  const text = fd(formData, "review");
  if (!rating) fieldErrors.rating = "Please enter a rating.";
  if (text.length > MAX_REVIEW_LENGTH) fieldErrors.review = `Keep your review under ${MAX_REVIEW_LENGTH} characters.`;
  return { rating, text, fieldErrors };
}

/**
 * Create a review. Only learners enrolled in the course may review it, once
 * per course; instructors cannot review their own course.
 */
export async function createReviewAction(_prev: ActionResult<Review> | null, formData: FormData): Promise<ActionResult<Review>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in to write a review." };

  const slug = fd(formData, "slug");
  const course = slug ? await getCourseBySlug(slug) : null;
  if (!course) return { ok: false, error: "This course no longer exists." };

  const db = await getDb();
  if (!db.settings.features.reviews) return { ok: false, error: "Reviews are disabled on this platform." };

  const { rating, text, fieldErrors } = validateReview(formData);
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: fieldErrors.rating ?? "Please fix the errors below.", fieldErrors };
  }

  if (course.instructorIds.includes(user.id)) return { ok: false, error: "Instructors can't review their own course." };

  const enrollment = await getEnrollment(user.id, course.id);
  if (!enrollment) return { ok: false, error: "You must be enrolled in the course to submit a review" };

  if (db.reviews.some((r) => r.userId === user.id && r.courseId === course.id)) {
    return { ok: false, error: "You have already reviewed this course" };
  }

  const review: Review = {
    id: uid("rev"),
    userId: user.id,
    courseId: course.id,
    rating: rating!,
    review: text,
    createdAt: new Date().toISOString(),
  };
  await insert("reviews", review);
  await notifyMany(
    course.instructorIds.filter((id) => id !== user.id),
    {
      type: "system",
      subject: `${user.name} rated ${course.title} ${rating} out of 5`,
      message: text ? truncate(text, 160) : undefined,
      link: `/courses/${course.slug}#reviews`,
      fromUserId: user.id,
    },
  );
  revalidateCourse(course);
  return { ok: true, data: review, message: "Thanks for your review!" };
}

/** Update your own review. */
export async function updateReviewAction(_prev: ActionResult<Review> | null, formData: FormData): Promise<ActionResult<Review>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };

  const id = fd(formData, "reviewId");
  const existing = id ? await findById("reviews", id) : null;
  if (!existing) return { ok: false, error: "This review no longer exists." };
  if (existing.userId !== user.id) return { ok: false, error: "You can only edit your own review." };

  const { rating, text, fieldErrors } = validateReview(formData);
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: fieldErrors.rating ?? "Please fix the errors below.", fieldErrors };
  }

  const updated = await update("reviews", existing.id, { rating: rating!, review: text });
  if (!updated) return { ok: false, error: "This review no longer exists." };

  const course = await findById("courses", existing.courseId);
  if (course) revalidateCourse(course);
  return { ok: true, data: updated, message: "Review updated." };
}

/** Delete your own review (moderators may remove any review). */
export async function deleteReviewAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };

  const id = fd(formData, "reviewId");
  const existing = id ? await findById("reviews", id) : null;
  if (!existing) return { ok: false, error: "This review no longer exists." };
  if (existing.userId !== user.id && !isModerator(user)) return { ok: false, error: "You can only delete your own review." };

  await remove("reviews", existing.id);
  const course = await findById("courses", existing.courseId);
  if (course) revalidateCourse(course);
  return { ok: true, data: undefined, message: existing.userId === user.id ? "Your review was deleted." : "Review deleted." };
}
