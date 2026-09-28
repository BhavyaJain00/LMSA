"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, CertificateEvaluation, CertificateRequest, EvaluatorSlot, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, hasRole, isModerator } from "@/lib/auth/session";
import { canEditAvailability, getAvailableSlots, getCourseEvaluators, isEvaluatorRole, platformNow, platformTimeZone } from "@/lib/data/certificates";
import { issueCertificate } from "@/lib/services/progress";
import { notify } from "@/lib/services/notifications";
import { fd, fdBool, fdNumber, isValidUrl, toDateKey, uid } from "@/lib/utils";
import {
  BOOKING_WINDOW_DAYS,
  EVALUATION_SLOT_MINUTES,
  addDaysToKey,
  clockToMinutes,
  formatClock12,
  formatLongDate,
  isValidClock,
  isValidDateKey,
  minutesToClock,
  timeZoneLabel,
} from "@/components/certificates/time";

/* ------------------------------------------------------------------ */
/* Evaluator weekly availability                                       */
/* ------------------------------------------------------------------ */

export interface SlotInput {
  day: number;
  startTime: string;
  endTime: string;
}

function validateSlot(input: SlotInput, others: EvaluatorSlot[]): string | null {
  const day = Number(input.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) return `${String(input.day)} is not a valid day.`;
  if (!input.startTime) return "Please enter a value for Start Time";
  if (!input.endTime) return "Please enter a value for End Time";
  if (!isValidClock(input.startTime)) return `${input.startTime} is not a valid time.`;
  if (!isValidClock(input.endTime)) return `${input.endTime} is not a valid time.`;
  const start = clockToMinutes(input.startTime);
  const end = clockToMinutes(input.endTime);
  if (start >= end) return "Start Time cannot be greater than End Time";
  if (end - start < EVALUATION_SLOT_MINUTES) return `A slot must be at least ${EVALUATION_SLOT_MINUTES} minutes long.`;
  const overlaps = others.some((s) => s.day === day && clockToMinutes(s.startTime) < end && start < clockToMinutes(s.endTime));
  if (overlaps) return "Slot Times are overlapping for some schedules.";
  return null;
}

async function revalidateEvaluator(evaluatorId: string) {
  const db = await getDb();
  const evaluator = db.users.find((u) => u.id === evaluatorId);
  if (evaluator) {
    revalidatePath(`/user/${evaluator.username}/slots`);
    revalidatePath(`/user/${evaluator.username}/schedule`);
  }
}

async function assertAvailabilityAccess(user: User | null, evaluatorId: string): Promise<string | null> {
  if (!user) return "You must be logged in.";
  if (!hasRole(user, "batch_evaluator", "moderator")) return "Only evaluators can manage availability.";
  if (!canEditAvailability(user, evaluatorId)) return "You can only see or change your own availability.";
  const db = await getDb();
  const evaluator = db.users.find((u) => u.id === evaluatorId);
  if (!evaluator || !isEvaluatorRole(evaluator)) return "This member is not an evaluator.";
  return null;
}

export async function addEvaluatorSlotAction(evaluatorId: string, input: SlotInput): Promise<ActionResult<{ slot: EvaluatorSlot }>> {
  const user = await getCurrentUser();
  const denied = await assertAvailabilityAccess(user, evaluatorId);
  if (denied) return { ok: false, error: denied };
  const db = await getDb();
  const others = db.evaluatorSlots.filter((s) => s.evaluatorId === evaluatorId);
  const error = validateSlot(input, others);
  if (error) return { ok: false, error };
  const slot: EvaluatorSlot = { id: uid("slot"), evaluatorId, day: Number(input.day), startTime: input.startTime, endTime: input.endTime };
  await mutate((d) => {
    d.evaluatorSlots.push(slot);
  });
  await revalidateEvaluator(evaluatorId);
  return { ok: true, data: { slot }, message: "Slot added successfully" };
}

export async function updateEvaluatorSlotAction(slotId: string, input: SlotInput): Promise<ActionResult<{ slot: EvaluatorSlot }>> {
  const user = await getCurrentUser();
  const db = await getDb();
  const existing = db.evaluatorSlots.find((s) => s.id === slotId);
  if (!existing) return { ok: false, error: "That slot no longer exists." };
  const denied = await assertAvailabilityAccess(user, existing.evaluatorId);
  if (denied) return { ok: false, error: denied };
  const others = db.evaluatorSlots.filter((s) => s.evaluatorId === existing.evaluatorId && s.id !== slotId);
  const error = validateSlot(input, others);
  if (error) return { ok: false, error };
  const updated = await mutate((d) => {
    const row = d.evaluatorSlots.find((s) => s.id === slotId);
    if (!row) return null;
    row.day = Number(input.day);
    row.startTime = input.startTime;
    row.endTime = input.endTime;
    return { ...row };
  });
  if (!updated) return { ok: false, error: "That slot no longer exists." };
  await revalidateEvaluator(existing.evaluatorId);
  return { ok: true, data: { slot: updated }, message: "Availability updated successfully" };
}

export async function deleteEvaluatorSlotAction(slotId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const db = await getDb();
  const existing = db.evaluatorSlots.find((s) => s.id === slotId);
  if (!existing) return { ok: false, error: "That slot no longer exists." };
  const denied = await assertAvailabilityAccess(user, existing.evaluatorId);
  if (denied) return { ok: false, error: denied };
  await mutate((d) => {
    d.evaluatorSlots = d.evaluatorSlots.filter((s) => s.id !== slotId);
  });
  await revalidateEvaluator(existing.evaluatorId);
  return { ok: true, data: undefined, message: "Slot deleted successfully" };
}

/* ------------------------------------------------------------------ */
/* Learner: book / cancel an evaluation                                */
/* ------------------------------------------------------------------ */

export async function bookEvaluationAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to schedule an evaluation." };

  const courseId = fd(formData, "courseId");
  const batchIdInput = fd(formData, "batchId");
  const evaluatorId = fd(formData, "evaluatorId");
  const date = fd(formData, "date");
  const startTime = fd(formData, "startTime");
  if (!evaluatorId || !date || !startTime) return { ok: false, error: "Please select a slot for your evaluation." };
  if (!isValidDateKey(date) || !isValidClock(startTime)) return { ok: false, error: "Please select a slot for your evaluation." };

  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, error: "This course no longer exists." };
  const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  if (!enrollment) return { ok: false, error: "You are not enrolled in this course." };
  if (db.certificates.some((c) => c.userId === user.id && c.courseId === course.id)) return { ok: false, error: "You are already certified for this course." };

  // Eligibility: purchased paid certificate, or membership of a certification batch with this course.
  let batchId: string | undefined;
  if (batchIdInput) {
    const batch = db.batches.find((b) => b.id === batchIdInput);
    const member = db.batchEnrollments.some((e) => e.batchId === batchIdInput && e.userId === user.id);
    if (!batch || !batch.certification || !member || !batch.courseIds.includes(course.id)) {
      return { ok: false, error: "You cannot book an evaluation for this batch." };
    }
    batchId = batch.id;
    if (batch.evaluationEndDate && date > batch.evaluationEndDate) {
      return { ok: false, error: `You cannot schedule evaluations after ${formatLongDate(batch.evaluationEndDate)}.` };
    }
  } else if (!(course.paidCertificate && enrollment.purchasedCertificate)) {
    return { ok: false, error: "Purchase the certificate for this course before scheduling an evaluation." };
  }

  // Evaluator: the course's evaluator, or any evaluator who publishes slots when none is assigned.
  const evaluators = await getCourseEvaluators(course);
  if (!evaluators.some((e) => e.id === evaluatorId)) return { ok: false, error: "That evaluator is not available for this course." };

  const { dateKey: today } = platformNow();
  const lastDay = addDaysToKey(today, BOOKING_WINDOW_DAYS - 1);
  if (date < today) return { ok: false, error: "You cannot schedule evaluations for past slots." };
  if (date > lastDay) return { ok: false, error: `Evaluations can be booked up to ${BOOKING_WINDOW_DAYS} days ahead.` };

  const existing = db.certificateRequests.find((r) => r.userId === user.id && r.courseId === course.id && r.status === "upcoming" && r.date >= today);
  if (existing) {
    return {
      ok: false,
      error: `You already have an evaluation on ${formatLongDate(existing.date)} at ${formatClock12(existing.startTime)} for the course ${course.title}.`,
    };
  }

  const takenByOther = db.certificateRequests.some(
    (r) => r.evaluatorId === evaluatorId && r.date === date && r.startTime === startTime && r.status !== "cancelled",
  );
  if (takenByOther) return { ok: false, error: "The slot is already booked by another participant." };

  const available = await getAvailableSlots(evaluatorId, { maxDate: lastDay });
  const slot = available.find((d) => d.date === date)?.slots.find((s) => s.startTime === startTime);
  if (!slot) {
    if (date === today) return { ok: false, error: "You cannot schedule evaluations for past slots." };
    return { ok: false, error: "That slot is no longer available. Please pick another one." };
  }

  const tz = platformTimeZone();
  const id = uid("creq");
  const request: CertificateRequest = {
    id,
    courseId: course.id,
    batchId,
    userId: user.id,
    evaluatorId,
    date,
    startTime,
    endTime: minutesToClock(clockToMinutes(startTime) + EVALUATION_SLOT_MINUTES),
    timezone: tz,
    meetingLink: `https://meet.example.com/eval-${id.replace(/^creq_/, "")}`,
    status: "upcoming",
    createdAt: new Date().toISOString(),
  };
  const inserted = await mutate((d) => {
    // Re-check inside the serialized mutation so two learners cannot grab the same slot.
    const clash = d.certificateRequests.some((r) => r.evaluatorId === evaluatorId && r.date === date && r.startTime === startTime && r.status !== "cancelled");
    if (clash) return false;
    d.certificateRequests.push(request);
    return true;
  });
  if (!inserted) return { ok: false, error: "The slot is already booked by another participant." };

  const evaluator = db.users.find((u) => u.id === evaluatorId);
  const when = `${formatLongDate(date)} at ${formatClock12(startTime)} (${timeZoneLabel(tz)})`;
  await notify(user.id, {
    type: "certificate",
    subject: "Your evaluation slot has been booked",
    message: `${course.title} — ${when}${evaluator ? ` with ${evaluator.name}` : ""}. Please prepare well and be on time for the evaluations.`,
    link: `/courses/${course.slug}/certification`,
  });
  if (evaluator) {
    await notify(evaluator.id, {
      type: "certificate",
      subject: `${user.name} booked an evaluation`,
      message: `${course.title} — ${when}.`,
      link: `/user/${evaluator.username}/schedule`,
      fromUserId: user.id,
    });
  }

  revalidatePath(`/courses/${course.slug}/certification`);
  revalidatePath("/dashboard");
  await revalidateEvaluator(evaluatorId);
  return { ok: true, data: { id }, message: "Your evaluation has been scheduled" };
}

export async function cancelEvaluationAction(requestId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const request = db.certificateRequests.find((r) => r.id === requestId);
  if (!request) return { ok: false, error: "This evaluation no longer exists." };
  if (request.userId !== user.id) return { ok: false, error: "You do not have permission to cancel this evaluation." };
  if (request.status !== "upcoming") return { ok: false, error: "Only upcoming evaluations can be cancelled." };
  const { dateKey: today, minutes } = platformNow();
  if (request.date < today || (request.date === today && clockToMinutes(request.startTime) <= minutes)) {
    return { ok: false, error: "This evaluation has already started." };
  }
  await mutate((d) => {
    const row = d.certificateRequests.find((r) => r.id === requestId);
    if (row) row.status = "cancelled";
  });
  const course = db.courses.find((c) => c.id === request.courseId);
  await notify(request.evaluatorId, {
    type: "certificate",
    subject: `${user.name} cancelled an evaluation`,
    message: `${course?.title ?? "Course"} — ${formatLongDate(request.date)} at ${formatClock12(request.startTime)}.`,
    link: undefined,
    fromUserId: user.id,
  });
  if (course) revalidatePath(`/courses/${course.slug}/certification`);
  revalidatePath("/dashboard");
  await revalidateEvaluator(request.evaluatorId);
  return { ok: true, data: undefined, message: "Evaluation cancelled successfully" };
}

/* ------------------------------------------------------------------ */
/* Evaluator: meeting link, evaluation result, certificate details     */
/* ------------------------------------------------------------------ */

async function loadRequestForEvaluator(user: User | null, requestId: string) {
  if (!user) return { error: "You must be logged in." } as const;
  const db = await getDb();
  const request = db.certificateRequests.find((r) => r.id === requestId);
  if (!request) return { error: "This evaluation no longer exists." } as const;
  if (!hasRole(user, "batch_evaluator", "moderator")) return { error: "Only evaluators can record evaluations." } as const;
  if (request.evaluatorId !== user.id && !isModerator(user)) return { error: "You are not the assigned evaluator for this course and batch." } as const;
  const course = db.courses.find((c) => c.id === request.courseId);
  const learner = db.users.find((u) => u.id === request.userId);
  if (!course || !learner) return { error: "The course or learner for this evaluation no longer exists." } as const;
  return { request, course, learner } as const;
}

export async function updateMeetingLinkAction(requestId: string, link: string): Promise<ActionResult<{ meetingLink: string }>> {
  const user = await getCurrentUser();
  const loaded = await loadRequestForEvaluator(user, requestId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? "Not allowed." };
  const value = (link ?? "").trim();
  if (!value || !/^https?:\/\//i.test(value) || !isValidUrl(value)) return { ok: false, error: "Please enter a valid URL." };
  await mutate((d) => {
    const row = d.certificateRequests.find((r) => r.id === requestId);
    if (row) row.meetingLink = value;
  });
  await notify(loaded.request.userId, {
    type: "certificate",
    subject: "Your evaluation meeting link was updated",
    message: `${loaded.course.title} — ${formatLongDate(loaded.request.date)} at ${formatClock12(loaded.request.startTime)}.`,
    link: `/courses/${loaded.course.slug}/certification`,
    fromUserId: user!.id,
  });
  revalidatePath(`/courses/${loaded.course.slug}/certification`);
  await revalidateEvaluator(loaded.request.evaluatorId);
  return { ok: true, data: { meetingLink: value }, message: "Meeting link saved" };
}

const EVAL_STATUSES: CertificateEvaluation["status"][] = ["pending", "in_progress", "pass", "fail"];

export async function saveEvaluationAction(
  _prev: ActionResult<{ status: CertificateEvaluation["status"]; certificateCode: string | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: CertificateEvaluation["status"]; certificateCode: string | null }>> {
  const user = await getCurrentUser();
  const requestId = fd(formData, "requestId");
  const loaded = await loadRequestForEvaluator(user, requestId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? "Not allowed." };
  const { request, course, learner } = loaded;

  const status = fd(formData, "status") as CertificateEvaluation["status"];
  const rating = Math.round(fdNumber(formData, "rating", 0));
  const summary = fd(formData, "summary");
  const fieldErrors: Record<string, string> = {};
  if (!EVAL_STATUSES.includes(status)) fieldErrors.status = "Choose a status.";
  if (rating < 0 || rating > 5) fieldErrors.rating = "Rating must be between 0 and 5.";
  if ((status === "pass" || status === "fail") && rating === 0) fieldErrors.rating = "Rating cannot be 0";
  if ((status === "pass" || status === "fail") && !summary) fieldErrors.summary = "Please add a summary of the evaluation.";
  if (summary.length > 5000) fieldErrors.summary = "The summary is too long.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const now = new Date().toISOString();
  await mutate((d) => {
    let row = d.certificateEvaluations.find((e) => e.userId === request.userId && e.courseId === request.courseId);
    if (!row) {
      row = {
        id: uid("ceval"),
        courseId: request.courseId,
        batchId: request.batchId,
        userId: request.userId,
        evaluatorId: request.evaluatorId,
        rating,
        summary: summary || undefined,
        date: request.date,
        startTime: request.startTime,
        endTime: request.endTime,
        status,
        createdAt: now,
      };
      d.certificateEvaluations.push(row);
    } else {
      row.rating = rating;
      row.summary = summary || undefined;
      row.status = status;
      row.date = request.date;
      row.startTime = request.startTime;
      row.endTime = request.endTime;
      row.evaluatorId = request.evaluatorId;
      if (request.batchId) row.batchId = request.batchId;
    }
    const req = d.certificateRequests.find((r) => r.id === request.id);
    if (req && (status === "pass" || status === "fail")) req.status = "completed";
  });

  let certificateCode: string | null = null;
  if (status === "pass") {
    const cert = await issueCertificate(learner, course, { batchId: request.batchId, evaluatorId: request.evaluatorId });
    if (!cert.evaluatorId) {
      await mutate((d) => {
        const row = d.certificates.find((c) => c.id === cert.id);
        if (row) row.evaluatorId = request.evaluatorId;
      });
    }
    certificateCode = cert.code;
  } else if (status === "fail") {
    await notify(learner.id, {
      type: "certificate",
      subject: `Your evaluation for ${course.title} is complete`,
      message: summary || "Unfortunately you did not pass this time. You can book another evaluation.",
      link: `/courses/${course.slug}/certification`,
      fromUserId: user!.id,
    });
  }

  revalidatePath(`/courses/${course.slug}/certification`);
  revalidatePath("/admin/certificates");
  revalidatePath("/certified-members");
  await revalidateEvaluator(request.evaluatorId);
  return { ok: true, data: { status, certificateCode }, message: "Evaluation saved successfully" };
}

export async function saveEvaluationCertificateAction(
  _prev: ActionResult<{ code: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ code: string }>> {
  const user = await getCurrentUser();
  const requestId = fd(formData, "requestId");
  const loaded = await loadRequestForEvaluator(user, requestId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? "Not allowed." };
  const { request, course, learner } = loaded;

  const published = fdBool(formData, "published");
  const issueDate = fd(formData, "issueDate") || toDateKey();
  const expiryRaw = fd(formData, "expiryDate");
  const fieldErrors: Record<string, string> = {};
  if (!isValidDateKey(issueDate)) fieldErrors.issueDate = "Enter a valid issue date.";
  if (expiryRaw && !isValidDateKey(expiryRaw)) fieldErrors.expiryDate = "Enter a valid expiry date.";
  else if (expiryRaw && expiryRaw <= issueDate) fieldErrors.expiryDate = "Expiry date must be after the issue date.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const db = await getDb();
  const evaluation = db.certificateEvaluations.find((e) => e.userId === request.userId && e.courseId === request.courseId);
  const hasCertificate = db.certificates.some((c) => c.userId === request.userId && c.courseId === request.courseId);
  if (!hasCertificate && evaluation?.status !== "pass") return { ok: false, error: "Mark the evaluation as Pass before issuing the certificate." };

  const cert = await issueCertificate(learner, course, { batchId: request.batchId, evaluatorId: request.evaluatorId, expiryDate: expiryRaw || undefined });
  await mutate((d) => {
    const row = d.certificates.find((c) => c.id === cert.id);
    if (!row) return;
    row.published = published;
    row.issueDate = issueDate;
    row.expiryDate = expiryRaw || undefined;
    row.evaluatorId = row.evaluatorId ?? request.evaluatorId;
    if (request.batchId && !row.batchId) row.batchId = request.batchId;
  });

  revalidatePath(`/certificates/${cert.code}`);
  revalidatePath(`/courses/${course.slug}/certification`);
  revalidatePath("/admin/certificates");
  revalidatePath("/certified-members");
  await revalidateEvaluator(request.evaluatorId);
  return { ok: true, data: { code: cert.code }, message: "Certificate saved successfully" };
}
