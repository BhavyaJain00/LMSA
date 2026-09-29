"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Announcement } from "@/lib/types";
import { findById, getDb, insert, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { notifyMany } from "@/lib/services/notifications";
import { courseAudienceText, sendCourseAnnouncementEmails } from "@/lib/email";
import { fd, isValidEmail, splitList, stripMarkdown, truncate, uid } from "@/lib/utils";

/**
 * Post an announcement to everyone enrolled in a course. Learners receive an
 * in-app notification that links back to the course.
 */
export async function createCourseAnnouncementAction(
  _prev: ActionResult<{ recipients: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ recipients: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };
  const course = await findById("courses", fd(formData, "courseId"));
  if (!course) return { ok: false, error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { ok: false, error: "You do not have permission to post announcements for this course." };

  const subject = fd(formData, "subject").replace(/\s+/g, " ");
  const body = fd(formData, "body");
  const cc = splitList(fd(formData, "cc")).map((e) => e.toLowerCase());
  const fieldErrors: Record<string, string> = {};
  if (!subject) fieldErrors.subject = "Add a subject.";
  else if (subject.length > 150) fieldErrors.subject = "Keep the subject under 150 characters.";
  if (!body) fieldErrors.body = "Write the announcement.";
  else if (body.length > 20_000) fieldErrors.body = "The announcement is too long (max 20,000 characters).";
  const badCc = cc.find((e) => !isValidEmail(e));
  if (badCc) fieldErrors.cc = `"${badCc}" is not a valid email address.`;
  else if (cc.length > 20) fieldErrors.cc = "Add at most 20 CC addresses.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the errors below.", fieldErrors };

  const db = await getDb();
  const learnerIds = db.enrollments.filter((e) => e.courseId === course.id && e.memberType !== "staff").map((e) => e.userId);
  // CC'd addresses that belong to members also get the in-app notification.
  const ccIds = db.users.filter((u) => cc.includes(u.email.toLowerCase())).map((u) => u.id);
  const recipients = Array.from(new Set([...learnerIds, ...ccIds])).filter((id) => id !== user.id);

  const announcement: Announcement = {
    id: uid("ann"),
    courseId: course.id,
    authorId: user.id,
    subject,
    body,
    cc: cc.length ? cc : undefined,
    createdAt: new Date().toISOString(),
  };
  await insert("announcements", announcement);
  await notifyMany(recipients, {
    type: "announcement",
    subject: `${course.title}: ${courseAudienceText(db, course, subject)}`,
    message: truncate(stripMarkdown(courseAudienceText(db, course, body)).replace(/\s+/g, " "), 200),
    link: `/courses/${course.slug}`,
    fromUserId: user.id,
    // Learners (and CC'd addresses) get the full announcement by email below.
    email: false,
  });
  const mail = await sendCourseAnnouncementEmails(announcement.id);
  revalidatePath(`/admin/courses/${course.id}`);
  revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/admin/emails");
  const emailed = !mail.disabled && mail.queued ? ` (${mail.queued} emailed)` : "";
  return {
    ok: true,
    data: { recipients: recipients.length },
    message: recipients.length ? `Announcement sent to ${recipients.length} ${recipients.length === 1 ? "learner" : "learners"}${emailed}` : "Announcement posted",
  };
}

export async function deleteCourseAnnouncementAction(announcementId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };
  const announcement = await findById("announcements", announcementId);
  if (!announcement || !announcement.courseId) return { ok: false, error: "This announcement no longer exists." };
  const course = await findById("courses", announcement.courseId);
  if (!course || !canManageCourse(user, course)) return { ok: false, error: "You do not have permission to delete this announcement." };
  if (announcement.authorId !== user.id && !isModerator(user) && !course.instructorIds.includes(user.id)) {
    return { ok: false, error: "You do not have permission to delete this announcement." };
  }
  await mutate((db) => {
    db.announcements = db.announcements.filter((a) => a.id !== announcementId);
  });
  revalidatePath(`/admin/courses/${course.id}`);
  revalidatePath(`/courses/${course.slug}`, "layout");
  return { ok: true, data: undefined, message: "Announcement deleted" };
}
