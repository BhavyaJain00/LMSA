"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Assignment, AssignmentStatus, AssignmentSubmission, AssignmentType, Lesson, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { getLessonHref } from "@/lib/data/courses";
import { getAssessmentAccess, lessonSubmissionLockError } from "@/lib/data/lessons";
import { canDeleteSubmissions, canManageAssessments, completeLessonFromAssessment, toSubmissionView } from "@/lib/data/assessments";
import { notify, notifyMany } from "@/lib/services/notifications";
import { evaluateBadges } from "@/lib/services/badges";
import { logActivity } from "@/lib/services/activity";
import { awardPoints, syncAssignmentPassPoints } from "@/lib/services/points";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, formatDateTime, isValidUrl, uid } from "@/lib/utils";
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_UPLOAD,
  assignmentScheduleState,
  fileExtension,
  isUploadType,
  lessonQuery,
  type AssignmentSubmissionView,
} from "@/components/assessments/shared";

const TYPES: AssignmentType[] = ["document", "pdf", "url", "image", "text"];
const STATUSES: AssignmentStatus[] = ["pass", "fail", "not_graded", "not_applicable"];
const MAX_TEXT = 50000;

function parseIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function revalidateAssignment(assignmentId: string, lessonId?: string | null) {
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/assignments/submissions");
  revalidatePath(`/assignments/${assignmentId}`);
  if (lessonId) {
    const href = await getLessonHref(lessonId);
    if (href) revalidatePath(href);
  }
}

/* ------------------------------------------------------------------ */
/* Admin: create / update / delete                                     */
/* ------------------------------------------------------------------ */

export async function saveAssignmentAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "Your role can't manage assignments." };

  const id = fd(formData, "id");
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const type = fd(formData, "type") as AssignmentType;
  const courseId = fd(formData, "courseId");
  const question = fd(formData, "question");
  const enableScheduling = fdBool(formData, "enableScheduling");
  const scheduleStartRaw = fd(formData, "scheduleStart");
  const scheduleEndRaw = fd(formData, "scheduleEnd");
  const showAnswer = fdBool(formData, "showAnswer");
  const answer = fd(formData, "answer");
  const gradeAssignment = fdBool(formData, "gradeAssignment");

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Title is required.";
  else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
  if (!TYPES.includes(type)) fieldErrors.type = "Choose a submission type.";
  if (!question) fieldErrors.question = "Question is required.";
  else if (question.length > MAX_TEXT) fieldErrors.question = "The question is too long.";
  if (answer.length > MAX_TEXT) fieldErrors.answer = "The model answer is too long.";
  if (showAnswer && !answer) fieldErrors.answer = "Add a model answer to show it to learners.";

  let scheduleStart: string | undefined;
  let scheduleEnd: string | undefined;
  if (enableScheduling) {
    const start = parseIso(scheduleStartRaw);
    const end = parseIso(scheduleEndRaw);
    if (!start) fieldErrors.scheduleStart = "Set a start time, or turn scheduling off.";
    if (scheduleEndRaw && !end) fieldErrors.scheduleEnd = "Enter a valid end date and time.";
    if (start && end && new Date(end).getTime() <= new Date(start).getTime()) fieldErrors.scheduleEnd = "The end time has to come after the start time.";
    scheduleStart = start ?? undefined;
    scheduleEnd = end ?? undefined;
  }

  const db = await getDb();
  if (courseId && !db.courses.some((c) => c.id === courseId)) fieldErrors.courseId = "That course no longer exists.";
  if (Object.keys(fieldErrors).length) {
    const first = Object.values(fieldErrors)[0]!;
    return { ok: false, error: first, fieldErrors };
  }

  const now = new Date().toISOString();
  let savedId = id;
  if (id) {
    const existing = db.assignments.find((a) => a.id === id);
    if (!existing) return { ok: false, error: "This assignment no longer exists." };
    await mutate((d) => {
      const row = d.assignments.find((a) => a.id === id);
      if (!row) return;
      row.title = title;
      row.type = type;
      row.courseId = courseId || undefined;
      row.question = question;
      row.enableScheduling = enableScheduling;
      row.scheduleStart = scheduleStart;
      row.scheduleEnd = scheduleEnd;
      row.showAnswer = showAnswer;
      row.answer = answer || undefined;
      row.gradeAssignment = gradeAssignment;
      row.updatedAt = now;
      // Keep the denormalized title on submissions in sync.
      for (const s of d.assignmentSubmissions) if (s.assignmentId === id) s.assignmentTitle = title;
    });
  } else {
    const assignment: Assignment = {
      id: uid("asg"),
      title,
      question,
      type,
      showAnswer,
      answer: answer || undefined,
      gradeAssignment,
      courseId: courseId || undefined,
      enableScheduling,
      scheduleStart,
      scheduleEnd,
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    };
    savedId = assignment.id;
    await mutate((d) => {
      d.assignments.push(assignment);
    });
  }

  await revalidateAssignment(savedId);
  await setFlash(id ? "Assignment updated successfully" : "Assignment created successfully");
  redirect("/admin/assignments");
}

export async function deleteAssignmentsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "Your role can't manage assignments." };
  const set = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  if (!set.size) return { ok: false, error: "Select at least one assignment." };

  const count = await mutate((d) => {
    const before = d.assignments.length;
    d.assignments = d.assignments.filter((a) => !set.has(a.id));
    d.assignmentSubmissions = d.assignmentSubmissions.filter((s) => !set.has(s.assignmentId));
    return before - d.assignments.length;
  });
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/assignments/submissions");
  for (const id of set) revalidatePath(`/assignments/${id}`);
  return { ok: true, data: { count }, message: count === 1 ? "Assignment deleted successfully" : "Assignments deleted successfully" };
}

/* ------------------------------------------------------------------ */
/* Learner: submit / update own submission                             */
/* ------------------------------------------------------------------ */

function validateAttachment(type: AssignmentType, url: string): string | null {
  if (!isUploadType(type)) return null;
  if (!url) return "Please upload a file before submitting.";
  if (!(url.startsWith("/uploads/") || /^https?:\/\//i.test(url))) return "Please upload the file again.";
  const ext = fileExtension(url);
  if (type === "image" && ext === ".svg") return "SVG images are not accepted. Please upload a PNG, JPG, GIF or WebP file.";
  if (!ASSIGNMENT_UPLOAD[type].extensions.includes(ext)) return ASSIGNMENT_UPLOAD[type].error;
  return null;
}

export interface SubmitAssignmentResult {
  submission: AssignmentSubmissionView;
  /** The lesson embedding this assignment is complete after this submission. */
  lessonCompleted: boolean;
}

export async function submitAssignmentAction(
  _prev: ActionResult<SubmitAssignmentResult> | null,
  formData: FormData,
): Promise<ActionResult<SubmitAssignmentResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to submit this assignment." };

  const assignmentId = fd(formData, "assignmentId");
  const rawAnswer = (formData.get("answer") as string | null) ?? "";
  const attachmentUrl = fd(formData, "attachmentUrl");
  const lessonIdInput = fd(formData, "lessonId");
  const courseIdInput = fd(formData, "courseId");

  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, error: "This assignment no longer exists." };

  const privileged = canManageAssessments(user);
  // Whatever lesson the form names: an assignment that lives only in lessons still locked for this
  // learner (drip schedule, enforced order, prerequisites) takes no submissions.
  if (!privileged) {
    const gate = await getAssessmentAccess(user, "assignment", assignment.id);
    if (!gate.ok) return { ok: false, error: gate.message };
  }
  const schedule = assignmentScheduleState(assignment, Date.now());
  if (schedule.blocked && !privileged) {
    return {
      ok: false,
      error:
        schedule.reason === "not_started"
          ? `${assignment.title} opens on ${formatDateTime(assignment.scheduleStart)}.`
          : `The schedule for ${assignment.title} has ended.`,
    };
  }

  const existing = db.assignmentSubmissions.find((s) => s.assignmentId === assignment.id && s.userId === user.id) ?? null;
  if (existing && (existing.status === "pass" || existing.status === "fail")) {
    return { ok: false, error: "This submission has been graded and can no longer be edited." };
  }

  // Type-specific validation.
  const type = assignment.type;
  let answer: string | undefined;
  let attachment: string | undefined;
  const fieldErrors: Record<string, string> = {};
  if (type === "text") {
    const text = rawAnswer.trim();
    if (!text) return { ok: false, error: "Add an answer or attach a file, then submit.", fieldErrors: { answer: "Write your answer here." } };
    if (text.length > MAX_TEXT) fieldErrors.answer = "Your answer is too long.";
    answer = text;
  } else if (type === "url") {
    const url = rawAnswer.trim();
    if (!url) return { ok: false, error: "Add an answer or attach a file, then submit.", fieldErrors: { answer: "Enter a URL." } };
    if (!/^https?:\/\//i.test(url) || !isValidUrl(url)) fieldErrors.answer = "Please enter a valid URL.";
    answer = url;
  } else {
    if (!attachmentUrl) return { ok: false, error: "Add an answer or attach a file, then submit.", fieldErrors: { attachmentUrl: "Upload a file." } };
    const err = validateAttachment(type, attachmentUrl);
    if (err) fieldErrors.attachmentUrl = err;
    attachment = attachmentUrl;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  // Only trust a lesson id if that lesson actually embeds this assignment.
  let lesson: Lesson | undefined;
  if (lessonIdInput) {
    lesson = db.lessons.find((l) => l.id === lessonIdInput && l.blocks.some((b) => b.type === "assignment" && b.assignmentId === assignment.id));
  }
  // A lesson that is still locked for this learner (drip, order, prerequisites) can't take submissions.
  if (lesson && !privileged) {
    const locked = await lessonSubmissionLockError(user, lesson.id, "assignment");
    if (locked) return { ok: false, error: locked };
  }
  const courseId =
    lesson?.courseId ?? (courseIdInput && db.courses.some((c) => c.id === courseIdInput) ? courseIdInput : undefined) ?? assignment.courseId;

  const now = new Date().toISOString();
  let saved: AssignmentSubmission;
  const isNew = !existing;
  if (existing) {
    saved = await mutate((d) => {
      const row = d.assignmentSubmissions.find((s) => s.id === existing.id)!;
      row.answer = answer;
      row.attachmentUrl = attachment;
      row.type = type;
      row.assignmentTitle = assignment.title;
      if (!row.lessonId && lesson) row.lessonId = lesson.id;
      if (!row.courseId && courseId) row.courseId = courseId;
      row.updatedAt = now;
      return { ...row };
    });
  } else {
    saved = {
      id: uid("asub"),
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      userId: user.id,
      courseId,
      lessonId: lesson?.id,
      type,
      attachmentUrl: attachment,
      answer,
      status: assignment.gradeAssignment ? "not_graded" : "not_applicable",
      submittedAt: now,
      updatedAt: now,
    };
    const toInsert = saved;
    await mutate((d) => {
      // Guard against a double submit racing past the duplicate check.
      if (d.assignmentSubmissions.some((s) => s.assignmentId === assignment.id && s.userId === user.id)) return;
      d.assignmentSubmissions.push(toInsert);
    });
  }

  if (isNew) {
    await logActivity(user.id, "assignment_submit", assignment.id);
    await awardPoints(user.id, "assignment_submit", { refId: assignment.id, lessonId: saved.lessonId });
    await notifyGraders(user, assignment, saved);
  }

  // Recording a submission from a lesson completes that lesson (when its other requirements are met).
  const completionLesson = lesson ?? (saved.lessonId ? db.lessons.find((l) => l.id === saved.lessonId) : undefined);
  let lessonCompleted = false;
  if (completionLesson) {
    const outcome = await completeLessonFromAssessment(user, completionLesson);
    lessonCompleted = outcome.completed;
  }

  await revalidateAssignment(assignment.id, saved.lessonId);
  return {
    ok: true,
    data: { submission: await toSubmissionView(saved), lessonCompleted },
    message: isNew ? "Assignment submitted successfully" : "Changes saved successfully",
  };
}

async function notifyGraders(user: User, assignment: Assignment, submission: AssignmentSubmission) {
  if (!assignment.gradeAssignment) return;
  const db = await getDb();
  const course = submission.courseId ? db.courses.find((c) => c.id === submission.courseId) : undefined;
  const recipients = new Set<string>(course?.instructorIds ?? []);
  if (!recipients.size) recipients.add(assignment.authorId);
  recipients.delete(user.id);
  await notifyMany(Array.from(recipients), {
    type: "assignment_graded",
    subject: "New assignment submission to grade",
    message: `${user.name} submitted ${assignment.title}.`,
    link: `/admin/assignments/submissions/${submission.id}`,
    fromUserId: user.id,
  });
}

/* ------------------------------------------------------------------ */
/* Staff: grading                                                      */
/* ------------------------------------------------------------------ */

export async function gradeAssignmentAction(_prev: ActionResult<{ status: AssignmentStatus }> | null, formData: FormData): Promise<ActionResult<{ status: AssignmentStatus }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "You are not permitted to grade submissions." };

  const submissionId = fd(formData, "submissionId");
  const status = fd(formData, "status") as AssignmentStatus;
  const comments = ((formData.get("comments") as string | null) ?? "").trim();
  if (!STATUSES.includes(status)) return { ok: false, error: "Choose a grade.", fieldErrors: { status: "Choose a grade." } };
  if (comments.length > MAX_TEXT) return { ok: false, error: "Comments are too long.", fieldErrors: { comments: "Comments are too long." } };

  const db = await getDb();
  const submission = db.assignmentSubmissions.find((s) => s.id === submissionId);
  if (!submission) return { ok: false, error: "This submission no longer exists." };
  const assignment = db.assignments.find((a) => a.id === submission.assignmentId);

  const statusChanged = submission.status !== status;
  const commentsChanged = (submission.comments ?? "") !== comments;
  if (!statusChanged && !commentsChanged) return { ok: true, data: { status }, message: "No changes to save" };

  const now = new Date().toISOString();
  const previousStatus = await mutate((d) => {
    const row = d.assignmentSubmissions.find((s) => s.id === submissionId);
    if (!row) return null;
    const before = row.status;
    row.status = status;
    row.comments = comments || undefined;
    if (row.userId !== user.id) row.evaluatorId = user.id;
    row.gradedAt = status === "pass" || status === "fail" ? now : undefined;
    row.updatedAt = now;
    return before;
  });

  const title = assignment?.title ?? submission.assignmentTitle;
  const link = `/assignments/${submission.assignmentId}${lessonQuery(submission.lessonId, submission.courseId)}`;
  if (statusChanged && (status === "pass" || status === "fail")) {
    await notify(submission.userId, {
      type: "assignment_graded",
      subject: `Your assignment ${title} was graded: ${ASSIGNMENT_STATUS_LABELS[status]}`,
      message: comments || undefined,
      link,
      fromUserId: user.id,
    });
  } else {
    await notify(submission.userId, {
      type: "assignment_graded",
      subject: `The instructor has left a comment on your assignment ${title}`,
      message: comments || `Status: ${ASSIGNMENT_STATUS_LABELS[status]}`,
      link,
      fromUserId: user.id,
    });
  }
  if (statusChanged && status === "pass") await evaluateBadges(submission.userId, "assignment_passed");
  // Points follow the grade stored now (re-read inside the write lock, so concurrent regrades stay consistent).
  if (previousStatus !== null && previousStatus !== status) await syncAssignmentPassPoints(submission.id, user.id);

  await revalidateAssignment(submission.assignmentId, submission.lessonId);
  revalidatePath(`/admin/assignments/submissions/${submission.id}`);
  return { ok: true, data: { status }, message: "Changes saved successfully" };
}

export async function deleteAssignmentSubmissionsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canDeleteSubmissions(user) || !isModerator(user)) return { ok: false, error: "Only moderators can delete submissions." };
  const set = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  if (!set.size) return { ok: false, error: "Select at least one submission." };
  const affected = await mutate((d) => {
    const removed = d.assignmentSubmissions.filter((s) => set.has(s.id));
    d.assignmentSubmissions = d.assignmentSubmissions.filter((s) => !set.has(s.id));
    return removed;
  });
  for (const s of affected) await revalidateAssignment(s.assignmentId, s.lessonId);
  return { ok: true, data: { count: affected.length }, message: "Submissions deleted successfully" };
}
