import "server-only";
import type { Enrollment, MemberType } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { notify, notifyMany } from "./notifications";
import { evaluateBadges } from "./badges";
import { logActivity } from "./activity";
import { computeProgramProgress } from "@/lib/data/programs";
import { sendBatchConfirmationEmail, sendCourseEnrollmentEmail } from "@/lib/email";
import { emit } from "@/lib/events";

/**
 * Enroll a user in a course (idempotent). Handles the side effects every
 * enrollment path shares: notification to instructors, badge rules, activity.
 * Self-enrollment paths pass `confirmationEmail: true` to email the learner a
 * confirmation (paid orders get a receipt instead; admins adding a learner
 * send an in-app notification that is emailed on its own).
 */
export async function enrollUserInCourse(
  userId: string,
  courseId: string,
  opts: { paymentId?: string; batchId?: string; memberType?: MemberType; notifyInstructors?: boolean; confirmationEmail?: boolean } = {},
): Promise<Enrollment> {
  const db = await getDb();
  const existing = db.enrollments.find((e) => e.userId === userId && e.courseId === courseId);
  if (existing) {
    // `batchId` is set only on enrollments a batch creates. It moves the drip anchor to the batch
    // start (see dripAnchor), so writing it onto a course the learner was already taking would
    // re-lock lessons they had been given (or release a whole schedule at once): joining a batch
    // never changes the schedule of an existing enrollment.
    if (opts.paymentId && !existing.paymentId) {
      await mutate((d) => {
        const row = d.enrollments.find((e) => e.id === existing.id);
        if (row && !row.paymentId) row.paymentId = opts.paymentId;
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
  const raced = await mutate((d) => {
    // Re-check inside the serialized write: a concurrent request (e.g. a double submit) may have enrolled meanwhile.
    const current = d.enrollments.find((e) => e.userId === userId && e.courseId === courseId);
    if (current) {
      if (opts.paymentId && !current.paymentId) current.paymentId = opts.paymentId;
      return current;
    }
    d.enrollments.push(enrollment);
    for (const program of d.programs) {
      if (!program.courseIds.includes(courseId)) continue;
      // Joining a course that belongs to a program the user is in keeps program progress accurate.
      const member = d.programMembers.find((m) => m.programId === program.id && m.userId === userId);
      if (member) member.progress = computeProgramProgress(d, program, userId);
    }
    return null;
  });
  if (raced) return raced;
  emit("enrollment.created", {
    enrollmentId: enrollment.id,
    userId,
    courseId,
    memberType: enrollment.memberType,
    paymentId: enrollment.paymentId,
    batchId: enrollment.batchId,
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
  if (opts.confirmationEmail) {
    try {
      await sendCourseEnrollmentEmail(userId, courseId);
    } catch (error) {
      console.error("[email] could not queue the enrollment confirmation:", error instanceof Error ? error.message : String(error));
    }
  }
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

  // Seat and duplicate checks are repeated inside the serialized write so concurrent requests cannot overbook.
  const outcome = await mutate((d): "joined" | "already" | "full" => {
    if (d.batchEnrollments.some((e) => e.batchId === batchId && e.userId === userId)) return "already";
    const taken = d.batchEnrollments.filter((e) => e.batchId === batchId).length;
    if (batch.seatCount > 0 && taken >= batch.seatCount) return "full";
    d.batchEnrollments.push({
      id: uid("ben"),
      batchId,
      userId,
      paymentId: opts.paymentId,
      source: opts.source ?? "Website",
      confirmationEmailSent: false,
      enrolledAt: new Date().toISOString(),
    });
    return "joined";
  });
  if (outcome === "already") return { ok: true };
  if (outcome === "full") return { ok: false, error: "This batch is full." };
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
  // The notification above normally carries the confirmation email; this is an idempotent safety net.
  try {
    await sendBatchConfirmationEmail(batchId, userId);
  } catch (error) {
    console.error("[email] could not queue the batch confirmation:", error instanceof Error ? error.message : String(error));
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
