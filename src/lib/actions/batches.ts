"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, AssessmentType, Batch, BatchMedium, Database, DiscussionReply, DiscussionTopic, TimetableItem, TimetableItemType, TimetableLegend, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, hasRole, isModerator } from "@/lib/auth/session";
import {
  acceptsEnrollment,
  canCreateBatch,
  canManageBatch,
  getBatchStatus,
} from "@/lib/data/batches";
import { enrollUserInBatch, enrollUserInCourse } from "@/lib/services/enrollment";
import { notifyMany } from "@/lib/services/notifications";
import { awardDiscussionReplyPoints, revokePoints } from "@/lib/services/points";
import { setFlash } from "@/lib/flash";
import { verificationError } from "@/lib/auth/verification";
import { currencies } from "@/lib/config";
import { fd, fdBool, isValidUrl, slugify, truncate, stripMarkdown, uid, uniqueSlug } from "@/lib/utils";
import { clockToMinutes, isClock, isDateKey, isValidTimeZone } from "@/components/batches/tz";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Guard = { ok: true; user: User; batch: Batch; db: Database } | { ok: false; error: string };

async function guardManager(batchId: string): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  if (!canManageBatch(user, batch)) return { ok: false, error: "You do not have permission to manage this batch." };
  return { ok: true, user, batch, db };
}

/** Enrolled learners and batch managers may take part in batch discussions. */
async function guardMember(batchId: string): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  const enrolled = db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === user.id);
  if (!enrolled && !canManageBatch(user, batch) && !hasRole(user, "batch_evaluator")) {
    return { ok: false, error: "You do not have access to this batch." };
  }
  return { ok: true, user, batch, db };
}

function revalidateBatch(batch: Pick<Batch, "id" | "slug">) {
  revalidatePath("/batches");
  revalidatePath(`/batches/${batch.slug}`);
  revalidatePath("/admin/batches");
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath("/dashboard");
  revalidatePath("/");
}

async function touchBatch(batchId: string) {
  await mutate((db) => {
    const b = db.batches.find((x) => x.id === batchId);
    if (b) b.updatedAt = new Date().toISOString();
  });
}

/**
 * In-app notice when a batch goes live (Settings → learning.notifyOnPublishedBatches).
 * Sent once per batch to enrolled students and moderators.
 */
async function announcePublishedBatch(batch: Batch, actor: User) {
  const db = await getDb();
  if (db.settings.learning.notifyOnPublishedBatches === "none") return;
  const link = `/batches/${batch.slug}`;
  const already = db.notifications.some((n) => n.type === "batch_published" && n.link === link && n.subject.includes("published a new batch"));
  if (already) return;
  const recipients = new Set<string>(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  for (const u of db.users) if (u.enabled && (u.roles.includes("moderator") || u.roles.includes("admin"))) recipients.add(u.id);
  recipients.delete(actor.id);
  await notifyMany(Array.from(recipients), {
    type: "batch_published",
    subject: `${actor.name} has published a new batch ${batch.title}`,
    message: batch.description,
    link,
    fromUserId: actor.id,
  });
}

/* ------------------------------------------------------------------ */
/* Batch form parsing & validation                                     */
/* ------------------------------------------------------------------ */

interface ParsedBatch {
  values: Omit<Batch, "id" | "createdById" | "createdAt" | "updatedAt" | "courseIds" | "assessments" | "timetable" | "timetableLegends">;
  fieldErrors: Record<string, string>;
}

function firstError(errors: Record<string, string>): string {
  return Object.values(errors)[0] ?? "Please fix the errors below.";
}

function parseBatchForm(formData: FormData, db: Database, existing: Batch | null, mode: "create" | "update"): ParsedBatch {
  const fieldErrors: Record<string, string> = {};
  const title = fd(formData, "title");
  const startDate = fd(formData, "startDate");
  const endDate = fd(formData, "endDate");
  const startTime = fd(formData, "startTime");
  const endTime = fd(formData, "endTime");
  const timezone = fd(formData, "timezone");
  const description = fd(formData, "description");
  const details = fd(formData, "details");
  const categoryId = fd(formData, "categoryId");
  const mediumRaw = fd(formData, "medium");
  const seatRaw = fd(formData, "seatCount");
  const instructorIds = Array.from(new Set(formData.getAll("instructorIds").filter((v): v is string => typeof v === "string" && !!v)));

  if (!title) fieldErrors.title = "Add a Title before saving.";
  else if (title.length > 140) fieldErrors.title = "Keep the title under 140 characters.";
  if (!isDateKey(startDate)) fieldErrors.startDate = "Add a Batch Start Date before saving.";
  if (!isDateKey(endDate)) fieldErrors.endDate = "Add a Batch End Date before saving.";
  if (!isClock(startTime)) fieldErrors.startTime = "Add a Session Start Time before saving.";
  if (!isClock(endTime)) fieldErrors.endTime = "Add a Session End Time before saving.";
  if (!timezone) fieldErrors.timezone = "Add a Timezone before saving.";
  else if (!isValidTimeZone(timezone)) fieldErrors.timezone = "Choose a valid timezone.";
  if (!description) fieldErrors.description = "Add a Short Description before saving.";
  else if (description.length > 500) fieldErrors.description = "Keep the short description under 500 characters.";
  if (!details) fieldErrors.details = "Add Batch Details before saving.";
  if (!instructorIds.length) fieldErrors.instructorIds = "Add at least one Instructor before saving.";
  else {
    const valid = instructorIds.every((id) => {
      const u = db.users.find((x) => x.id === id);
      return !!u && u.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin" || r === "batch_evaluator");
    });
    if (!valid) fieldErrors.instructorIds = "Instructors must be staff members (instructors, evaluators or moderators).";
  }
  if (isDateKey(startDate) && isDateKey(endDate) && endDate < startDate) fieldErrors.endDate = "Batch end date cannot be before the batch start date";
  if (isClock(startTime) && isClock(endTime) && clockToMinutes(startTime) >= clockToMinutes(endTime)) {
    fieldErrors.endTime = "Batch start time cannot be greater than or equal to end time.";
  }
  if (categoryId && !db.categories.some((c) => c.id === categoryId)) fieldErrors.categoryId = "Choose a valid category.";
  const medium: BatchMedium = mediumRaw === "offline" ? "offline" : "online";

  const seatCount = seatRaw === "" ? 0 : Number(seatRaw);
  if (!Number.isInteger(seatCount)) fieldErrors.seatCount = "Seat count must be a whole number.";
  else if (seatCount < 0) fieldErrors.seatCount = "Seat count cannot be negative.";
  else if (existing && seatCount > 0) {
    const enrolled = db.batchEnrollments.filter((e) => e.batchId === existing.id).length;
    if (seatCount < enrolled) fieldErrors.seatCount = `There are already ${enrolled} students enrolled. Seat count cannot be lower than that.`;
  }

  const base = {
    title,
    startDate,
    endDate,
    startTime,
    endTime,
    timezone,
    description,
    details,
    categoryId: categoryId || undefined,
    medium,
    seatCount: Number.isInteger(seatCount) && seatCount > 0 ? seatCount : 0,
  };

  if (mode === "create") {
    return {
      fieldErrors,
      values: {
        ...base,
        slug: uniqueSlug(title || "batch", db.batches.map((b) => b.slug)),
        imageUrl: undefined,
        paidBatch: false,
        amount: 0,
        currency: db.settings.commerce.defaultCurrency || "USD",
        published: false,
        allowSelfEnrollment: false,
        allowFuture: true,
        showLiveClass: false,
        certification: false,
        evaluationEndDate: undefined,
        instructorIds,
        conferencingProvider: undefined,
      },
    };
  }

  const slugInput = fd(formData, "slug");
  const slug = slugify(slugInput || title || "batch");
  if (slugInput && slugInput !== slug) fieldErrors.slug = `Use lowercase letters, numbers and dashes, e.g. "${slug}".`;
  else if (db.batches.some((b) => b.slug === slug && b.id !== existing?.id)) fieldErrors.slug = "Another batch already uses this URL.";

  const imageUrl = fd(formData, "imageUrl");
  if (imageUrl && !isValidUrl(imageUrl)) fieldErrors.imageUrl = "Enter a valid image URL or upload an image.";

  const paidBatch = fdBool(formData, "paidBatch");
  const amountRaw = fd(formData, "amount");
  const currency = fd(formData, "currency").toUpperCase();
  let amount = 0;
  if (paidBatch) {
    const major = Number(amountRaw);
    if (!currency) fieldErrors.currency = "Currency is required for paid batches.";
    else if (!(currencies as readonly string[]).includes(currency) && !/^[A-Z]{3}$/.test(currency)) fieldErrors.currency = "Use a 3-letter currency code.";
    if (!amountRaw || !Number.isFinite(major) || major <= 0) fieldErrors.amount = "Amount must be a positive number for paid batches.";
    else amount = Math.round(major * 100);
  }

  const certification = fdBool(formData, "certification");
  const evaluationEndDate = fd(formData, "evaluationEndDate");
  if (evaluationEndDate) {
    if (!isDateKey(evaluationEndDate)) fieldErrors.evaluationEndDate = "Enter a valid date.";
    else if (isDateKey(endDate) && evaluationEndDate < endDate) fieldErrors.evaluationEndDate = "Evaluation end date cannot be less than the batch end date.";
  }

  const providerRaw = fd(formData, "conferencingProvider");
  const conferencingProvider = providerRaw === "zoom" || providerRaw === "google_meet" || providerRaw === "custom" ? providerRaw : undefined;

  return {
    fieldErrors,
    values: {
      ...base,
      slug,
      imageUrl: imageUrl || undefined,
      paidBatch,
      amount: paidBatch ? amount : existing?.amount ?? 0,
      currency: currency || existing?.currency || db.settings.commerce.defaultCurrency || "USD",
      published: fdBool(formData, "published"),
      allowSelfEnrollment: fdBool(formData, "allowSelfEnrollment"),
      allowFuture: fdBool(formData, "allowFuture"),
      showLiveClass: fdBool(formData, "showLiveClass"),
      certification,
      evaluationEndDate: evaluationEndDate || undefined,
      instructorIds,
      conferencingProvider,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create / update / publish / delete                                  */
/* ------------------------------------------------------------------ */

export async function createBatchAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canCreateBatch(user)) return { ok: false, error: "You are not permitted to create a batch." };
  const db = await getDb();
  const { values, fieldErrors } = parseBatchForm(formData, db, null, "create");
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  const now = new Date().toISOString();
  const batch: Batch = {
    ...values,
    id: uid("bat"),
    courseIds: [],
    assessments: [],
    timetable: [],
    timetableLegends: [],
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    // Re-check the slug inside the serialized mutation.
    batch.slug = uniqueSlug(batch.title, d.batches.map((b) => b.slug));
    d.batches.push(batch);
  });
  revalidateBatch(batch);
  await setFlash("Batch created successfully", "success");
  redirect(`/admin/batches/${batch.id}?tab=settings`);
}

export async function updateBatchAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardManager(fd(formData, "batchId"));
  if (!guard.ok) return guard;
  const { user, batch, db } = guard;
  const { values, fieldErrors } = parseBatchForm(formData, db, batch, "update");
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  const wasPublished = batch.published;
  const oldSlug = batch.slug;
  const saved = await mutate((d): Batch | null => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return null;
    Object.assign(row, values, { updatedAt: new Date().toISOString() });
    return { ...row };
  });
  if (!saved) return { ok: false, error: "This batch no longer exists." };
  if (!wasPublished && saved.published) await announcePublishedBatch(saved, user);
  if (oldSlug !== saved.slug) revalidatePath(`/batches/${oldSlug}`);
  revalidateBatch(saved);
  return { ok: true, data: undefined, message: "Batch updated successfully" };
}

export async function setBatchPublishedAction(batchId: string, published: boolean): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { user, batch } = guard;
  if (published) {
    const missing: string[] = [];
    if (!batch.description) missing.push("a short description");
    if (!batch.details) missing.push("batch details");
    if (!batch.instructorIds.length) missing.push("an instructor");
    if (missing.length) return { ok: false, error: `Add ${missing.join(", ")} before publishing.` };
  }
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (row) {
      row.published = published;
      row.updatedAt = new Date().toISOString();
    }
  });
  if (published && !batch.published) await announcePublishedBatch({ ...batch, published: true }, user);
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: published ? "Batch published" : "Batch unpublished" };
}

/** Cascade-delete a batch with its enrollments, classes, announcements, feedback and discussions. */
export async function deleteBatchAction(batchId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  await mutate((d) => {
    d.batches = d.batches.filter((b) => b.id !== batch.id);
    d.batchEnrollments = d.batchEnrollments.filter((e) => e.batchId !== batch.id);
    d.batchFeedback = d.batchFeedback.filter((f) => f.batchId !== batch.id);
    d.liveClasses = d.liveClasses.filter((c) => c.batchId !== batch.id);
    d.announcements = d.announcements.filter((a) => a.batchId !== batch.id);
    d.emailTemplates = d.emailTemplates.filter((t) => t.batchId !== batch.id);
    const topicIds = new Set(d.discussionTopics.filter((t) => t.refType === "batch" && t.refId === batch.id).map((t) => t.id));
    d.discussionTopics = d.discussionTopics.filter((t) => !topicIds.has(t.id));
    d.discussionReplies = d.discussionReplies.filter((r) => !topicIds.has(r.topicId));
    // Course enrollments stay (learners keep their progress) but are detached from the batch.
    for (const e of d.enrollments) if (e.batchId === batch.id) e.batchId = undefined;
  });
  revalidateBatch(batch);
  await setFlash("Batch deleted successfully", "success");
  redirect("/admin/batches");
}

/* ------------------------------------------------------------------ */
/* Enrollment                                                          */
/* ------------------------------------------------------------------ */

/** Self-enrollment from the batch page ("Enroll Now"). */
export async function enrollInBatchAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === fd(formData, "batchId"));
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Please log in to enroll in this batch", "warning");
    redirect(`/login?next=${encodeURIComponent(`/batches/${batch.slug}`)}`);
  }
  if (!db.settings.features.batches) return { ok: false, error: "Batches are currently disabled on this platform." };
  const manager = canManageBatch(user, batch);
  if (!batch.published && !manager) return { ok: false, error: "This batch is not open for enrollment." };
  if (db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === user.id)) {
    return { ok: false, error: "You are already enrolled in this batch." };
  }
  if (!acceptsEnrollment(batch)) {
    return { ok: false, error: getBatchStatus(batch) === "completed" ? "This batch has already ended." : "Enrollment for this batch is closed." };
  }
  // Members who must confirm their email can't enroll until they do (Settings → Security).
  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: blocked };
  let paymentId: string | undefined;
  if (batch.paidBatch && batch.amount > 0) {
    const payment = db.payments.find((p) => p.userId === user.id && p.itemType === "batch" && p.itemId === batch.id && p.status === "paid");
    if (!payment && !manager) return { ok: false, error: "Payment is required to enroll in this batch." };
    paymentId = payment?.id;
  } else if (!batch.allowSelfEnrollment && !manager) {
    return { ok: false, error: "Enrollment in this batch is restricted. Please contact the Administrator." };
  }
  const result = await enrollUserInBatch(user.id, batch.id, { paymentId, source: "Website" });
  if (!result.ok) return { ok: false, error: result.error === "This batch is full." ? "There are no seats available in this batch." : result.error };
  revalidateBatch(batch);
  await setFlash("You have been enrolled in this batch", "success");
  redirect(`/batches/${batch.slug}?tab=courses`);
}

/** Admin: enroll one or more users (source recorded on the enrollment). */
export async function addBatchStudentsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardManager(fd(formData, "batchId"));
  if (!guard.ok) return guard;
  const { batch, db } = guard;
  const userIds = Array.from(new Set(formData.getAll("userIds").filter((v): v is string => typeof v === "string" && !!v)));
  const source = fd(formData, "source") || "Manual";
  if (!userIds.length) return { ok: false, error: "Please select a student to enroll.", fieldErrors: { userIds: "Select at least one student." } };
  if (source.length > 60) return { ok: false, error: "Keep the source under 60 characters.", fieldErrors: { source: "Too long" } };

  const enrolled = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  const already = userIds.filter((id) => enrolled.has(id));
  const unknown = userIds.filter((id) => !db.users.some((u) => u.id === id && u.enabled));
  if (unknown.length) return { ok: false, error: "Some selected users no longer exist or are disabled." };
  const toAdd = userIds.filter((id) => !enrolled.has(id));
  if (!toAdd.length) return { ok: false, error: "Member already enrolled in this batch" };
  if (batch.seatCount > 0 && enrolled.size + toAdd.length > batch.seatCount) {
    const left = Math.max(0, batch.seatCount - enrolled.size);
    return { ok: false, error: left ? `Only ${left} seat${left === 1 ? "" : "s"} left in this batch.` : "There are no seats available in this batch." };
  }
  let added = 0;
  for (const id of toAdd) {
    const res = await enrollUserInBatch(id, batch.id, { source });
    if (!res.ok) return { ok: false, error: res.error };
    added++;
  }
  await touchBatch(batch.id);
  revalidateBatch(batch);
  const skipped = already.length ? ` (${already.length} already enrolled)` : "";
  return { ok: true, data: undefined, message: added === 1 ? `Student enrolled successfully${skipped}` : `${added} students enrolled successfully${skipped}` };
}

/** Admin: remove a student from the batch. Their course progress is kept. */
export async function removeBatchStudentAction(batchId: string, userId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch, db } = guard;
  if (!db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === userId)) {
    return { ok: false, error: "This student is not enrolled in the batch." };
  }
  await mutate((d) => {
    d.batchEnrollments = d.batchEnrollments.filter((e) => !(e.batchId === batch.id && e.userId === userId));
    for (const c of d.liveClasses) if (c.batchId === batch.id) c.attendeeIds = c.attendeeIds.filter((id) => id !== userId);
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Student removed from the batch" };
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export async function addBatchCourseAction(batchId: string, courseId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch, db, user } = guard;
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, error: "Please select a course." };
  if (!course.published && !isModerator(user) && !course.instructorIds.includes(user.id) && course.createdById !== user.id) {
    return { ok: false, error: "Only published courses can be added to a batch." };
  }
  if (batch.courseIds.includes(course.id)) return { ok: false, error: `Course ${course.title} has already been added to this batch.` };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (row && !row.courseIds.includes(course.id)) {
      row.courseIds.push(course.id);
      row.updatedAt = new Date().toISOString();
    }
  });
  // Existing students get access to the new course right away.
  for (const e of db.batchEnrollments.filter((x) => x.batchId === batch.id)) {
    await enrollUserInCourse(e.userId, course.id, { batchId: batch.id, paymentId: e.paymentId, notifyInstructors: false });
  }
  revalidateBatch(batch);
  revalidatePath(`/courses/${course.slug}`);
  return { ok: true, data: undefined, message: "Course added to batch successfully" };
}

export async function removeBatchCourseAction(batchId: string, courseId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  if (!batch.courseIds.includes(courseId)) return { ok: false, error: "This course is not part of the batch." };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (row) {
      row.courseIds = row.courseIds.filter((id) => id !== courseId);
      row.updatedAt = new Date().toISOString();
    }
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Course removed from the batch" };
}

export async function moveBatchCourseAction(batchId: string, courseId: string, direction: "up" | "down"): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  const index = batch.courseIds.indexOf(courseId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= batch.courseIds.length) return { ok: false, error: "This course cannot be moved further." };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    const ids = [...row.courseIds];
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    row.courseIds = ids;
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined };
}

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

export async function addBatchAssessmentAction(batchId: string, type: AssessmentType, refId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch, db } = guard;
  if (type !== "quiz" && type !== "assignment" && type !== "exercise") return { ok: false, error: "Choose an assessment type." };
  const doc =
    type === "quiz" ? db.quizzes.find((q) => q.id === refId) : type === "assignment" ? db.assignments.find((a) => a.id === refId) : db.exercises.find((e) => e.id === refId);
  if (!doc) return { ok: false, error: "Please select an assessment." };
  if (batch.assessments.some((a) => a.type === type && a.refId === refId)) {
    return { ok: false, error: `Assessment ${doc.title} has already been added to this batch.` };
  }
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    row.assessments.push({ id: uid("bas"), type, refId });
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Assessment added successfully" };
}

export async function removeBatchAssessmentAction(batchId: string, assessmentId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  if (!batch.assessments.some((a) => a.id === assessmentId)) return { ok: false, error: "This assessment is not part of the batch." };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    row.assessments = row.assessments.filter((a) => a.id !== assessmentId);
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Assessment removed" };
}

/* ------------------------------------------------------------------ */
/* Timetable                                                           */
/* ------------------------------------------------------------------ */

const TIMETABLE_TYPES: TimetableItemType[] = ["course", "lesson", "live_class", "quiz", "assignment", "exercise", "custom"];

function refTitle(db: Database, type: TimetableItemType, refId: string): string | null {
  switch (type) {
    case "course":
      return db.courses.find((c) => c.id === refId)?.title ?? null;
    case "lesson":
      return db.lessons.find((l) => l.id === refId)?.title ?? null;
    case "live_class":
      return db.liveClasses.find((c) => c.id === refId)?.title ?? null;
    case "quiz":
      return db.quizzes.find((q) => q.id === refId)?.title ?? null;
    case "assignment":
      return db.assignments.find((a) => a.id === refId)?.title ?? null;
    case "exercise":
      return db.exercises.find((e) => e.id === refId)?.title ?? null;
    default:
      return null;
  }
}

export async function saveTimetableItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardManager(fd(formData, "batchId"));
  if (!guard.ok) return guard;
  const { batch, db } = guard;
  const itemId = fd(formData, "itemId");
  const type = fd(formData, "type") as TimetableItemType;
  const refId = fd(formData, "refId");
  let title = fd(formData, "title");
  const date = fd(formData, "date");
  const startTime = fd(formData, "startTime");
  const endTime = fd(formData, "endTime");
  const legendId = fd(formData, "legendId");
  const milestone = fdBool(formData, "milestone");

  const fieldErrors: Record<string, string> = {};
  if (!TIMETABLE_TYPES.includes(type)) fieldErrors.type = "Choose what this item is.";
  if (type && type !== "custom") {
    if (!refId) fieldErrors.refId = "Pick the item to link to.";
    else {
      const t = refTitle(db, type, refId);
      if (!t) fieldErrors.refId = "The selected item no longer exists.";
      else if (!title) title = t;
      if (type === "live_class" && !db.liveClasses.some((c) => c.id === refId && c.batchId === batch.id)) fieldErrors.refId = "Pick a live class from this batch.";
    }
  }
  if (!title) fieldErrors.title = "Add a title.";
  else if (title.length > 140) fieldErrors.title = "Keep the title under 140 characters.";
  const lastDay = batch.evaluationEndDate && batch.evaluationEndDate > batch.endDate ? batch.evaluationEndDate : batch.endDate;
  if (!isDateKey(date)) fieldErrors.date = "Pick a date.";
  else if (date < batch.startDate || date > lastDay) fieldErrors.date = `Pick a date between ${batch.startDate} and ${lastDay}.`;
  if (startTime && !isClock(startTime)) fieldErrors.startTime = "Use the HH:mm format.";
  if (endTime && !isClock(endTime)) fieldErrors.endTime = "Use the HH:mm format.";
  if (endTime && !startTime) fieldErrors.startTime = "Add a start time as well.";
  if (isClock(startTime) && isClock(endTime) && clockToMinutes(startTime) >= clockToMinutes(endTime)) fieldErrors.endTime = "End time must be after the start time.";
  if (legendId && !batch.timetableLegends.some((l) => l.id === legendId)) fieldErrors.legendId = "Choose a legend from the list.";
  if (itemId && !batch.timetable.some((t) => t.id === itemId)) return { ok: false, error: "This timetable item no longer exists." };
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  const item: TimetableItem = {
    id: itemId || uid("tt"),
    type,
    refId: type === "custom" ? undefined : refId,
    title,
    date,
    startTime: startTime || undefined,
    endTime: endTime || undefined,
    milestone,
    legendId: legendId || undefined,
  };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    const idx = row.timetable.findIndex((t) => t.id === item.id);
    if (idx === -1) row.timetable.push(item);
    else row.timetable[idx] = item;
    row.timetable.sort((a, b) => `${a.date} ${a.startTime ?? ""}`.localeCompare(`${b.date} ${b.startTime ?? ""}`));
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: itemId ? "Timetable item updated" : "Timetable item added" };
}

export async function deleteTimetableItemAction(batchId: string, itemId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    row.timetable = row.timetable.filter((t) => t.id !== itemId);
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Timetable item deleted" };
}

export async function clearTimetableAction(batchId: string): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    row.timetable = [];
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Timetable cleared" };
}

export async function saveTimetableLegendsAction(batchId: string, legends: { id?: string; label: string; color: string }[]): Promise<ActionResult> {
  const guard = await guardManager(batchId);
  if (!guard.ok) return guard;
  const { batch } = guard;
  if (!Array.isArray(legends) || legends.length > 20) return { ok: false, error: "Use at most 20 legends." };
  const clean: TimetableLegend[] = [];
  for (const [i, l] of legends.entries()) {
    const label = typeof l.label === "string" ? l.label.trim() : "";
    const color = typeof l.color === "string" ? l.color.trim() : "";
    if (!label) return { ok: false, error: `Legend ${i + 1} needs a label.` };
    if (label.length > 40) return { ok: false, error: `Legend "${label}" is too long (max 40 characters).` };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: `Legend "${label}" needs a color like #4f46e5.` };
    const existing = l.id && batch.timetableLegends.some((x) => x.id === l.id) ? l.id : undefined;
    clean.push({ id: existing ?? uid("lg"), label, color: color.toLowerCase() });
  }
  const labels = clean.map((l) => l.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return { ok: false, error: "Legend labels must be unique." };
  await mutate((d) => {
    const row = d.batches.find((b) => b.id === batch.id);
    if (!row) return;
    row.timetableLegends = clean;
    const ids = new Set(clean.map((l) => l.id));
    for (const item of row.timetable) if (item.legendId && !ids.has(item.legendId)) item.legendId = undefined;
    row.updatedAt = new Date().toISOString();
  });
  revalidateBatch(batch);
  return { ok: true, data: undefined, message: "Legends saved" };
}

/* ------------------------------------------------------------------ */
/* Discussions (refType "batch")                                       */
/* ------------------------------------------------------------------ */

function discussionsEnabled(db: Database): boolean {
  return db.settings.features.discussions;
}

/** Notify @username mentions who belong to the batch. */
async function notifyMentions(db: Database, batch: Batch, author: User, content: string, link: string, skip: Set<string>) {
  const handles = Array.from(new Set(Array.from(content.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]{1,40})/gi)).map((m) => m[2]!.toLowerCase())));
  if (!handles.length) return;
  const members = new Set([...db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId), ...batch.instructorIds]);
  const ids = db.users
    .filter((u) => handles.includes(u.username.toLowerCase()) && u.id !== author.id && (members.has(u.id) || isModerator(u)) && !skip.has(u.id))
    .map((u) => u.id);
  await notifyMany(ids, {
    type: "mention",
    subject: `${author.name} mentioned you in ${batch.title}`,
    message: truncate(stripMarkdown(content), 140),
    link,
    fromUserId: author.id,
  });
}

export async function createBatchTopicAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardMember(fd(formData, "batchId"));
  if (!guard.ok) return guard;
  const { user, batch, db } = guard;
  if (!discussionsEnabled(db)) return { ok: false, error: "Discussions are disabled on this platform." };
  const title = fd(formData, "title");
  const content = fd(formData, "content");
  const fieldErrors: Record<string, string> = {};
  if (title.length < 3) fieldErrors.title = "Give your topic a title (at least 3 characters).";
  else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
  if (!content) fieldErrors.content = "Write a message to start the discussion.";
  else if (content.length > 10000) fieldErrors.content = "Keep your message under 10,000 characters.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  const now = new Date().toISOString();
  const topic: DiscussionTopic = { id: uid("dt"), refType: "batch", refId: batch.id, batchId: batch.id, authorId: user.id, title, createdAt: now, updatedAt: now };
  const reply: DiscussionReply = { id: uid("dr"), topicId: topic.id, authorId: user.id, content, createdAt: now, updatedAt: now };
  await mutate((d) => {
    d.discussionTopics.push(topic);
    d.discussionReplies.push(reply);
  });
  const link = `/batches/${batch.slug}?tab=discussions#topic-${topic.id}`;
  const instructors = batch.instructorIds.filter((id) => id !== user.id);
  await notifyMany(instructors, {
    type: "system",
    subject: `${user.name} started a discussion in ${batch.title}`,
    message: title,
    link,
    fromUserId: user.id,
  });
  await notifyMentions(db, batch, user, content, link, new Set(instructors));
  revalidatePath(`/batches/${batch.slug}`);
  return { ok: true, data: undefined, message: "Discussion started" };
}

export async function replyBatchTopicAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const db = await getDb();
  const topic = db.discussionTopics.find((t) => t.id === fd(formData, "topicId") && t.refType === "batch");
  if (!topic) return { ok: false, error: "This discussion no longer exists." };
  const guard = await guardMember(topic.refId);
  if (!guard.ok) return guard;
  const { user, batch } = guard;
  if (!discussionsEnabled(db)) return { ok: false, error: "Discussions are disabled on this platform." };
  const content = fd(formData, "content");
  if (!content) return { ok: false, error: "Write a reply first.", fieldErrors: { content: "Write a reply first." } };
  if (content.length > 10000) return { ok: false, error: "Keep your reply under 10,000 characters.", fieldErrors: { content: "Too long" } };

  const now = new Date().toISOString();
  await mutate((d) => {
    d.discussionReplies.push({ id: uid("dr"), topicId: topic.id, authorId: user.id, content, createdAt: now, updatedAt: now });
    const t = d.discussionTopics.find((x) => x.id === topic.id);
    if (t) t.updatedAt = now;
  });
  const link = `/batches/${batch.slug}?tab=discussions#topic-${topic.id}`;
  const participants = new Set<string>([topic.authorId, ...db.discussionReplies.filter((r) => r.topicId === topic.id).map((r) => r.authorId)]);
  participants.delete(user.id);
  await notifyMany(Array.from(participants), {
    type: "reply",
    subject: `${user.name} replied to "${truncate(topic.title, 60)}"`,
    message: truncate(stripMarkdown(content), 140),
    link,
    fromUserId: user.id,
  });
  await notifyMentions(db, batch, user, content, link, participants);
  await awardDiscussionReplyPoints(db.discussionReplies.find((r) => r.topicId === topic.id && r.authorId === user.id && r.createdAt === now)?.id);
  revalidatePath(`/batches/${batch.slug}`);
  return { ok: true, data: undefined, message: "Reply posted" };
}

export async function updateBatchReplyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const reply = db.discussionReplies.find((r) => r.id === fd(formData, "replyId"));
  const topic = reply ? db.discussionTopics.find((t) => t.id === reply.topicId && t.refType === "batch") : null;
  if (!reply || !topic) return { ok: false, error: "This reply no longer exists." };
  if (reply.authorId !== user.id && !isModerator(user)) return { ok: false, error: "You can only edit your own replies." };
  const content = fd(formData, "content");
  if (!content) return { ok: false, error: "A reply cannot be empty.", fieldErrors: { content: "A reply cannot be empty." } };
  if (content.length > 10000) return { ok: false, error: "Keep your reply under 10,000 characters.", fieldErrors: { content: "Too long" } };
  await mutate((d) => {
    const r = d.discussionReplies.find((x) => x.id === reply.id);
    if (r) {
      r.content = content;
      r.updatedAt = new Date().toISOString();
    }
  });
  const batch = db.batches.find((b) => b.id === topic.refId);
  if (batch) revalidatePath(`/batches/${batch.slug}`);
  return { ok: true, data: undefined, message: "Reply updated" };
}

export async function deleteBatchReplyAction(replyId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const reply = db.discussionReplies.find((r) => r.id === replyId);
  const topic = reply ? db.discussionTopics.find((t) => t.id === reply.topicId && t.refType === "batch") : null;
  const batch = topic ? db.batches.find((b) => b.id === topic.refId) : null;
  if (!reply || !topic || !batch) return { ok: false, error: "This reply no longer exists." };
  if (reply.authorId !== user.id && !canManageBatch(user, batch)) return { ok: false, error: "You can only delete your own replies." };
  // The earliest reply holds the topic's opening message; removing it would
  // leave a discussion without a body. Delete the discussion instead.
  const opening = db.discussionReplies
    .filter((r) => r.topicId === topic.id)
    .reduce<typeof reply | null>((first, r) => (!first || r.createdAt.localeCompare(first.createdAt) < 0 ? r : first), null);
  if (opening?.id === reply.id) return { ok: false, error: "This is the discussion's opening message. Delete the discussion instead." };
  await revokePoints("discussion_reply", reply.id);
  await mutate((d) => {
    d.discussionReplies = d.discussionReplies.filter((r) => r.id !== reply.id);
  });
  revalidatePath(`/batches/${batch.slug}`);
  return { ok: true, data: undefined, message: "Reply deleted" };
}

export async function deleteBatchTopicAction(topicId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const topic = db.discussionTopics.find((t) => t.id === topicId && t.refType === "batch");
  const batch = topic ? db.batches.find((b) => b.id === topic.refId) : null;
  if (!topic || !batch) return { ok: false, error: "This discussion no longer exists." };
  if (topic.authorId !== user.id && !canManageBatch(user, batch)) return { ok: false, error: "You can only delete discussions you started." };
  await revokePoints("discussion_reply", db.discussionReplies.filter((r) => r.topicId === topic.id).map((r) => r.id));
  await mutate((d) => {
    d.discussionTopics = d.discussionTopics.filter((t) => t.id !== topic.id);
    d.discussionReplies = d.discussionReplies.filter((r) => r.topicId !== topic.id);
  });
  revalidatePath(`/batches/${batch.slug}`);
  return { ok: true, data: undefined, message: "Discussion deleted" };
}
