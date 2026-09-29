import "server-only";
import type { Enrollment, MemberType } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { notify, notifyMany } from "./notifications";
import { evaluateBadges } from "./badges";
import { logActivity } from "./activity";
import { computeProgramProgress } from "@/lib/data/programs";

/**
 * Enroll a user in a course (idempotent). Handles the side effects every
 * enrollment path shares: notification to instructors, badge rules, activity.
 */
export async function enrollUserInCourse(
  userId: string,
  courseId: string,
  opts: { paymentId?: string; batchId?: string; memberType?: MemberType; notifyInstructors?: boolean } = {},
): Promise<Enrollment> {
  const db = await getDb();
  const existing = db.enrollments.find((e) => e.userId === userId && e.courseId === courseId);
  if (existing) {
    if ((opts.paymentId && !existing.paymentId) || (opts.batchId && !existing.batchId)) {
      await mutate((d) => {
        const row = d.enrollments.find((e) => e.id === existing.id);
        if (row) {
          if (opts.paymentId && !row.paymentId) row.paymentId = opts.paymentId;
          if (opts.batchId && !row.batchId) row.batchId = opts.batchId;
        }
      });
    }
    return existing;
  }
  const enrollment: Enrollment = {
    id: uid("enr"),
    userId,
    courseId,
    memberType: opts.memberType ?? "student",
    enrolledAt: new Date().toISOString(),
    progress: 0,
    purchasedCertificate: false,
    paymentId: opts.paymentId,
    batchId: opts.batchId,
  };
  await mutate((d) => {
    d.enrollments.push(enrollment);
    for (const program of d.programs) {
      if (!program.courseIds.includes(courseId)) continue;
      // Joining a course that belongs to a program the user is in keeps program progress accurate.
      const member = d.programMembers.find((m) => m.programId === program.id && m.userId === userId);
      if (member) member.progress = computeProgramProgress(d, program, userId);
    }
  });
  await logActivity(userId, "enroll", courseId);
  const course = db.courses.find((c) => c.id === courseId);
  const user = db.users.find((u) => u.id === userId);
  if (course && user && (opts.notifyInstructors ?? true) && enrollment.memberType === "student") {
    await notifyMany(course.instructorIds, {
      type: "enrollment",
      subject: `${user.name} enrolled in ${course.title}`,
      link: `/admin/courses/${course.id}/dashboard`,
      fromUserId: userId,
    });
  }
  if (enrollment.memberType === "student") await evaluateBadges(userId, "course_enrolled");
  return enrollment;
}

/**
 * Enroll a user in a batch: creates the batch enrollment and enrolls them in
 * every course of the batch. Returns false when the batch is full.
 */
export async function enrollUserInBatch(userId: string, batchId: string, opts: { paymentId?: string; source?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Batch not found" };
  const already = db.batchEnrollments.some((e) => e.batchId === batchId && e.userId === userId);
  if (already) return { ok: true };
  const count = db.batchEnrollments.filter((e) => e.batchId === batchId).length;
  if (batch.seatCount > 0 && count >= batch.seatCount) return { ok: false, error: "This batch is full." };

  await mutate((d) => {
    d.batchEnrollments.push({
      id: uid("ben"),
      batchId,
      userId,
      paymentId: opts.paymentId,
      source: opts.source ?? "Website",
      confirmationEmailSent: false,
      enrolledAt: new Date().toISOString(),
    });
  });
  for (const courseId of batch.courseIds) {
    await enrollUserInCourse(userId, courseId, { batchId, paymentId: opts.paymentId, notifyInstructors: false });
  }
  const user = db.users.find((u) => u.id === userId);
  await notify(userId, {
    type: "batch_published",
    subject: `You're enrolled in ${batch.title}`,
    message: `Starts ${batch.startDate} at ${batch.startTime} (${batch.timezone}).`,
    link: `/batches/${batch.slug}`,
  });
  if (user) {
    await notifyMany(batch.instructorIds, {
      type: "enrollment",
      subject: `${user.name} joined ${batch.title}`,
      link: `/admin/batches/${batch.id}`,
      fromUserId: userId,
    });
  }
  await logActivity(userId, "enroll", batchId);
  return { ok: true };
}

export async function unenrollUserFromCourse(userId: string, courseId: string): Promise<void> {
  await mutate((d) => {
    d.enrollments = d.enrollments.filter((e) => !(e.userId === userId && e.courseId === courseId));
    d.progress = d.progress.filter((p) => !(p.userId === userId && p.courseId === courseId));
    d.videoWatches = d.videoWatches.filter((w) => !(w.userId === userId && w.courseId === courseId));
  });
}
