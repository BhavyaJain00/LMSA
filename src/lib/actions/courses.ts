"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, CardGradient, Category, Course, Database, MemberType, User } from "@/lib/types";
import type { CourseFormValues, EnrollCandidate, StudentProgressDetail } from "@/components/admin/courses/types";
import { isBlockedVideoHost } from "@/components/admin/courses/blocks";
import { cardGradients, currencies } from "@/lib/config";
import { findById, getDb, insert, mutate, update } from "@/lib/db/store";
import { getCurrentUser, hasRole, isModerator } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { RESERVED_COURSE_SLUGS, canCreateCourses, getStudentProgressDetail, getWorkflowFlags, searchEnrollCandidates } from "@/lib/data/admin-courses";
import { enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { notify, notifyMany, notifyModerators } from "@/lib/services/notifications";
import { setFlash } from "@/lib/flash";
import { audit } from "@/lib/audit";
import { fd, fdBool, isValidUrl, toDateKey, uid, unique, uniqueSlug } from "@/lib/utils";
import { MAX_PREREQUISITES, findPrerequisiteCycle } from "@/components/learn/drip-shared";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function revalidateCourse(course: Pick<Course, "id" | "slug">) {
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath("/courses");
  revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
}

async function loadManageable(courseId: string): Promise<{ user: User; course: Course } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  const course = await findById("courses", courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to modify this course." };
  return { user, course };
}

function getList(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/** Parse a price typed in major units ("49.99") into the smallest unit. */
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const META_DESCRIPTION_MAX = 160;
const META_KEYWORDS_MAX = 500;

/** "a, b ,,A" → "a, b": trimmed, de-duplicated (case-insensitive), comma separated. */
function normalizeKeywords(raw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\r\n]/)) {
    const kw = part.trim().replace(/\s+/g, " ");
    if (!kw || seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
  }
  return out.join(", ");
}

interface ParsedCourseForm {
  values: CourseFormValues;
  fieldErrors: Record<string, string>;
  slugProvided: boolean;
}

async function parseCourseForm(formData: FormData, user: User, existing: Course | null): Promise<ParsedCourseForm> {
  const db = await getDb();
  const fieldErrors: Record<string, string> = {};

  const title = fd(formData, "title").replace(/\s+/g, " ");
  if (!title) fieldErrors.title = "Add a Title before saving.";
  else if (title.length > 140) fieldErrors.title = "Keep the title under 140 characters.";

  const rawSlug = fd(formData, "slug").toLowerCase();
  const slugProvided = rawSlug.length > 0;
  // A blank slug keeps the current one when editing, or derives a free, non-reserved slug from the title.
  const slug = slugProvided
    ? rawSlug
    : existing
      ? existing.slug
      : uniqueSlug(title, [...db.courses.map((c) => c.slug), ...RESERVED_COURSE_SLUGS]);
  if (slugProvided) {
    if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and single hyphens only.";
    else if (slug.length > 80) fieldErrors.slug = "Keep the slug under 80 characters.";
    else if (RESERVED_COURSE_SLUGS.includes(slug)) fieldErrors.slug = `"${slug}" is reserved. Pick another slug.`;
    else if (db.courses.some((c) => c.slug === slug && c.id !== existing?.id)) fieldErrors.slug = "This slug is already used by another course.";
  }

  const shortIntroduction = fd(formData, "shortIntroduction").replace(/\s+/g, " ");
  if (!shortIntroduction) fieldErrors.shortIntroduction = "Add a Short Introduction before saving.";
  else if (shortIntroduction.length > 300) fieldErrors.shortIntroduction = "Keep the short introduction under 300 characters.";

  const description = fd(formData, "description");
  if (!description.replace(/<[^>]*>/g, "").trim()) fieldErrors.description = "Add a Description before saving.";
  else if (description.length > 50_000) fieldErrors.description = "The description is too long (max 50,000 characters).";

  const imageUrl = fd(formData, "imageUrl") || undefined;
  if (imageUrl && !isValidUrl(imageUrl)) fieldErrors.imageUrl = "Enter a valid image URL or upload an image.";

  const videoUrl = fd(formData, "videoUrl") || undefined;
  if (videoUrl) {
    if (!isValidUrl(videoUrl)) fieldErrors.videoUrl = "Enter a valid video URL or upload a video.";
    else if (isBlockedVideoHost(videoUrl)) fieldErrors.videoUrl = "YouTube and Vimeo links can't be used. Upload the video or paste a direct .mp4/.webm URL.";
  }

  const gradientRaw = fd(formData, "cardGradient");
  const cardGradient: CardGradient = (cardGradients as readonly string[]).includes(gradientRaw)
    ? (gradientRaw as CardGradient)
    : (existing?.cardGradient ?? cardGradients[Math.floor(Math.random() * cardGradients.length)]!);

  const categoryId = fd(formData, "categoryId") || undefined;
  if (categoryId && !db.categories.some((c) => c.id === categoryId)) fieldErrors.categoryId = "Pick a category from the list.";

  const tagMap = new Map<string, string>();
  for (const t of getList(formData, "tags")) {
    const tag = t.replace(/\s+/g, " ").slice(0, 32);
    if (!tagMap.has(tag.toLowerCase())) tagMap.set(tag.toLowerCase(), tag);
  }
  const tags = Array.from(tagMap.values());
  if (tags.length > 12) fieldErrors.tags = "Use at most 12 tags.";

  const instructorPool = new Set(
    db.users.filter((u) => u.enabled && u.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin")).map((u) => u.id),
  );
  let instructorIds = unique(getList(formData, "instructorIds"));
  if (instructorIds.some((id) => !instructorPool.has(id))) fieldErrors.instructorIds = "Instructors must be course creators or moderators.";
  if (!existing && instructorIds.length === 0) instructorIds = [user.id];
  if (instructorIds.length === 0) fieldErrors.instructorIds = "Add at least one Instructor before saving.";
  else if (existing && !isModerator(user) && existing.createdById !== user.id && !instructorIds.includes(user.id)) {
    fieldErrors.instructorIds = "You can't remove yourself from the instructors of this course.";
  }

  const evaluatorId = fd(formData, "evaluatorId") || undefined;
  if (evaluatorId) {
    const ev = db.users.find((u) => u.id === evaluatorId);
    if (!ev || !ev.roles.some((r) => r === "batch_evaluator" || r === "moderator" || r === "admin")) fieldErrors.evaluatorId = "Pick an evaluator from the list.";
  }

  const cleanLines = (key: string, label: string) => {
    const items = unique(getList(formData, key).map((s) => s.replace(/\s+/g, " ")));
    if (items.length > 20) fieldErrors[key] = `Add at most 20 ${label}.`;
    if (items.some((s) => s.length > 200)) fieldErrors[key] = `Keep each of the ${label} under 200 characters.`;
    return items.slice(0, 20);
  };
  const outcomes = cleanLines("outcomes", "outcomes");
  const requirements = cleanLines("requirements", "requirements");

  const relatedCourseIds = unique(getList(formData, "relatedCourseIds")).filter((id) => id !== existing?.id);
  if (relatedCourseIds.some((id) => !db.courses.some((c) => c.id === id))) fieldErrors.relatedCourseIds = "One of the related courses no longer exists.";
  if (relatedCourseIds.length > 12) fieldErrors.relatedCourseIds = "Pick at most 12 related courses.";

  return {
    slugProvided,
    fieldErrors,
    values: {
      title,
      slug,
      shortIntroduction,
      description,
      imageUrl,
      videoUrl,
      cardGradient,
      categoryId,
      tags,
      instructorIds,
      evaluatorId,
      outcomes,
      requirements,
      relatedCourseIds,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

export async function createCourseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };
  if (!canCreateCourses(user)) return { ok: false, error: "Your role can't create courses." };

  const { values, fieldErrors, slugProvided } = await parseCourseForm(formData, user, null);
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const db = await getDb();
  const slug = slugProvided ? values.slug : uniqueSlug(values.title, [...db.courses.map((c) => c.slug), ...RESERVED_COURSE_SLUGS]);
  const now = new Date().toISOString();
  const course: Course = {
    ...values,
    id: uid("crs"),
    slug,
    price: 0,
    currency: db.settings.commerce.defaultCurrency || "USD",
    paidCourse: false,
    paidCertificate: false,
    certificatePrice: 0,
    enableCertification: false,
    published: false,
    upcoming: false,
    featured: false,
    disableSelfLearning: false,
    enforceLessonCompletion: false,
    status: "in_progress",
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await insert("courses", course);
  revalidateCourse(course);
  await setFlash("Course created successfully");
  redirect(`/admin/courses/${course.id}?tab=settings`);
}

export async function updateCourseAction(_prev: ActionResult<{ slug: string }> | null, formData: FormData): Promise<ActionResult<{ slug: string }>> {
  const loaded = await loadManageable(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;

  const { values, fieldErrors } = await parseCourseForm(formData, user, course);
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  // Content edits by creators invalidate a pending or granted review of an unpublished course.
  const resetReview = !isModerator(user) && !course.published && course.status !== "in_progress";
  const previousSlug = course.slug;
  const next = await update("courses", course.id, {
    ...values,
    status: resetReview ? "in_progress" : course.status,
    updatedAt: new Date().toISOString(),
  });
  if (!next) return { ok: false, error: "This course no longer exists." };
  revalidateCourse(next);
  if (previousSlug !== next.slug) revalidatePath(`/courses/${previousSlug}`, "layout");
  return {
    ok: true,
    data: { slug: next.slug },
    message: resetReview ? "Course updated. It moved back to In progress, so submit it for review again when you're ready." : "Course updated successfully",
  };
}

export async function updateCourseSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const loaded = await loadManageable(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course } = loaded;
  const db = await getDb();
  const fieldErrors: Record<string, string> = {};

  const featured = fdBool(formData, "featured");
  const upcoming = fdBool(formData, "upcoming");
  const disableSelfLearning = !fdBool(formData, "selfEnrollment");
  const enforceLessonCompletion = fdBool(formData, "enforceLessonCompletion");
  const paidCourse = fdBool(formData, "paidCourse");
  const enableCertification = fdBool(formData, "enableCertification");
  // Paid certificates are only offered on free courses.
  const paidCertificate = !paidCourse && fdBool(formData, "paidCertificate");

  const currencyRaw = fd(formData, "currency").toUpperCase();
  const currency = (currencies as readonly string[]).includes(currencyRaw) ? currencyRaw : "";
  const price = parsePrice(fd(formData, "price"));
  const certificatePrice = parsePrice(fd(formData, "certificatePrice"));
  const evaluatorId = fd(formData, "evaluatorId") || course.evaluatorId;

  const gatewayMissing = db.settings.commerce.paymentGateway === "none";
  if (paidCourse) {
    if (!course.paidCourse && gatewayMissing) fieldErrors.paidCourse = "Selling a paid course needs a payment gateway. Configure one in Settings → Payments first.";
    if (!currency) fieldErrors.currency = "Currency is required for paid courses.";
    if (!price || price <= 0) fieldErrors.price = "Price must be a positive number for paid courses.";
  }
  if (paidCertificate) {
    if (!course.paidCertificate && gatewayMissing) fieldErrors.paidCertificate = "Selling a paid certificate needs a payment gateway. Configure one in Settings → Payments first.";
    if (!currency) fieldErrors.currency = "Currency is required for paid certificates.";
    if (!certificatePrice || certificatePrice <= 0) fieldErrors.certificatePrice = "Price must be a positive number for paid certificates.";
    if (!evaluatorId) fieldErrors.evaluatorId = "Evaluator is required for paid certificates.";
    else if (!db.users.some((u) => u.id === evaluatorId && u.roles.some((r) => r === "batch_evaluator" || r === "moderator" || r === "admin"))) {
      fieldErrors.evaluatorId = "Pick an evaluator from the list.";
    }
  }
  if (enableCertification && paidCertificate) fieldErrors.enableCertification = "A course cannot have both paid certificate and certificate of completion.";
  const metaDescription = fd(formData, "metaDescription").replace(/\s+/g, " ");
  if (metaDescription.length > META_DESCRIPTION_MAX) fieldErrors.metaDescription = `Keep the meta description under ${META_DESCRIPTION_MAX} characters.`;
  const metaKeywords = normalizeKeywords(fd(formData, "metaKeywords"));
  if (metaKeywords.length > META_KEYWORDS_MAX) fieldErrors.metaKeywords = `Keep the meta keywords under ${META_KEYWORDS_MAX} characters.`;

  // Prerequisites are saved only when the form rendered that section (the marker field), so a
  // submission from a form that never loaded them cannot wipe them.
  const prerequisiteInput = fd(formData, "prerequisitesField") === "1" ? getList(formData, "prerequisiteCourseIds") : null;
  if (prerequisiteInput) {
    // Early answer for the form; the rules are checked again inside the write below.
    const parsed = parsePrerequisites(prerequisiteInput, course, db);
    if ("error" in parsed) fieldErrors.prerequisiteCourseIds = parsed.error;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted settings.", fieldErrors };

  // Like prerequisites, the AI tutor switch is saved only when the form rendered it.
  const aiTutorEnabled = fd(formData, "aiTutorField") === "1" ? fdBool(formData, "aiTutorEnabled") : null;
  const changes: Partial<Course> = {
    featured,
    upcoming,
    disableSelfLearning,
    enforceLessonCompletion,
    paidCourse,
    price: paidCourse ? (price ?? 0) : 0,
    currency: currency || course.currency,
    enableCertification,
    paidCertificate,
    certificatePrice: paidCertificate ? (certificatePrice ?? 0) : 0,
    evaluatorId,
    metaDescription: metaDescription || undefined,
    metaKeywords: metaKeywords || undefined,
    ...(aiTutorEnabled === null ? {} : { aiTutorEnabled: aiTutorEnabled || undefined }),
    updatedAt: new Date().toISOString(),
  };
  // The prerequisite rules (courses exist and are published, no cycle) are applied inside the
  // serialized write, against the courses as they are at that moment: two saves racing ("A requires
  // B" and "B requires A") can't both pass against a graph that lacks the other's pending write.
  const saved = await mutate((d): { course: Course } | { error: string } | null => {
    const index = d.courses.findIndex((c) => c.id === course.id);
    const current = d.courses[index];
    if (!current) return null;
    const next: Course = { ...current, ...changes };
    if (prerequisiteInput) {
      const parsed = parsePrerequisites(prerequisiteInput, current, d);
      if ("error" in parsed) return { error: parsed.error };
      next.prerequisiteCourseIds = parsed.ids.length ? parsed.ids : undefined;
    }
    d.courses[index] = next;
    return { course: next };
  });
  if (!saved) return { ok: false, error: "This course no longer exists." };
  if ("error" in saved) return { ok: false, error: "Please fix the highlighted settings.", fieldErrors: { prerequisiteCourseIds: saved.error } };
  revalidateCourse(saved.course);
  return { ok: true, data: undefined, message: "Course settings saved" };
}

/**
 * Validate the prerequisite course ids of a settings submission: existing
 * courses other than this one, published (a prerequisite that was already set
 * may stay while unpublished), at most MAX_PREREQUISITES, and no cycles
 * (A requires B … requires A would lock learners out of every course in the loop).
 */
function parsePrerequisites(raw: string[], course: Course, db: Database): { ids: string[] } | { error: string } {
  const ids = unique(raw);
  if (ids.includes(course.id)) return { error: "A course can't be its own prerequisite." };
  if (ids.length > MAX_PREREQUISITES) return { error: `Pick at most ${MAX_PREREQUISITES} prerequisite courses.` };
  const current = new Set(course.prerequisiteCourseIds ?? []);
  for (const id of ids) {
    const target = db.courses.find((c) => c.id === id);
    if (!target) return { error: "One of the prerequisite courses no longer exists. Reload the page and try again." };
    if (!target.published && !current.has(id)) return { error: `“${target.title}” is not published, so learners can't complete it. Pick a published course.` };
  }
  const graph = new Map(db.courses.filter((c) => c.id !== course.id).map((c) => [c.id, c.prerequisiteCourseIds ?? []]));
  const loop = findPrerequisiteCycle(course.id, ids, graph);
  if (loop) {
    const title = db.courses.find((c) => c.id === loop)?.title ?? "One of the selected courses";
    return { error: `“${title}” already requires this course (directly or through other courses), so it can't be a prerequisite too.` };
  }
  return { ids };
}

/* ------------------------------------------------------------------ */
/* Review & publishing workflow                                        */
/* ------------------------------------------------------------------ */

export async function setCoursePublishedAction(courseId: string, published: boolean): Promise<ActionResult<{ published: boolean }>> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  const flags = getWorkflowFlags(user, course);

  if (published) {
    if (course.published) return { ok: true, data: { published: true }, message: "Course is already published" };
    if (!flags.canPublish) {
      return { ok: false, error: "Only approved courses can be published. Submit the course for review and wait for a moderator to approve it." };
    }
  } else if (!flags.canUnpublish) {
    return { ok: false, error: "Could not update publish status" };
  }

  const firstPublish = published && !course.publishedOn;
  const next = await update("courses", course.id, {
    published,
    publishedOn: published ? (course.publishedOn ?? toDateKey()) : course.publishedOn,
    status: published ? "approved" : course.status,
    updatedAt: new Date().toISOString(),
  });
  if (!next) return { ok: false, error: "This course no longer exists." };
  await audit(user, published ? "course.publish" : "course.unpublish", { type: "course", id: course.id }, { title: course.title, firstPublish });

  if (firstPublish) {
    const db = await getDb();
    const instructorNames = next.instructorIds.map((id) => db.users.find((u) => u.id === id)?.name).filter(Boolean);
    if (db.settings.learning.notifyOnPublishedCourses !== "none") {
      const audience = db.users.filter((u) => u.enabled && !next.instructorIds.includes(u.id)).map((u) => u.id);
      await notifyMany(audience, {
        type: "course_published",
        subject: `${instructorNames[0] ?? "An instructor"} has published a new course ${next.title}`,
        message: next.shortIntroduction,
        link: `/courses/${next.slug}`,
        fromUserId: next.instructorIds[0],
      });
    }
    await notifyMany(
      next.instructorIds.filter((id) => id !== user.id),
      { type: "course_published", subject: `${next.title} is now live`, message: `${user.name} published your course.`, link: `/courses/${next.slug}`, fromUserId: user.id },
    );
  }
  revalidateCourse(next);
  return { ok: true, data: { published }, message: published ? "Course published" : "Course unpublished" };
}

export async function submitCourseForReviewAction(courseId: string): Promise<ActionResult> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  if (!getWorkflowFlags(user, course).canSubmitForReview) return { ok: false, error: "This course can't be submitted for review right now." };

  const db = await getDb();
  const lessonCount = db.lessons.filter((l) => l.courseId === course.id).length;
  if (lessonCount === 0) return { ok: false, error: "Add at least one lesson before submitting the course for review." };

  const next = await update("courses", course.id, { status: "under_review", updatedAt: new Date().toISOString() });
  if (!next) return { ok: false, error: "This course no longer exists." };
  await notifyModerators({
    type: "system",
    subject: `${user.name} submitted ${course.title} for review`,
    message: course.shortIntroduction,
    link: `/admin/courses/${course.id}?tab=settings`,
    fromUserId: user.id,
  });
  revalidateCourse(next);
  return { ok: true, data: undefined, message: "Submitted for review. Moderators have been notified." };
}

export async function approveCourseAction(courseId: string): Promise<ActionResult> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  if (!getWorkflowFlags(user, course).canApprove) return { ok: false, error: "Only moderators can approve courses that are under review." };

  const next = await update("courses", course.id, { status: "approved", updatedAt: new Date().toISOString() });
  if (!next) return { ok: false, error: "This course no longer exists." };
  await audit(user, "course.approve", { type: "course", id: course.id }, { title: course.title });
  await notifyMany(
    course.instructorIds.filter((id) => id !== user.id),
    {
      type: "system",
      subject: `${course.title} was approved`,
      message: "Your course passed review. You can publish it whenever you're ready.",
      link: `/admin/courses/${course.id}?tab=settings`,
      fromUserId: user.id,
    },
  );
  revalidateCourse(next);
  return { ok: true, data: undefined, message: "Course approved" };
}

export async function requestCourseChangesAction(courseId: string, note: string): Promise<ActionResult> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  if (!getWorkflowFlags(user, course).canRequestChanges) return { ok: false, error: "Only moderators can send a course back for changes." };
  const message = typeof note === "string" ? note.trim().slice(0, 2000) : "";

  const next = await update("courses", course.id, { status: "in_progress", updatedAt: new Date().toISOString() });
  if (!next) return { ok: false, error: "This course no longer exists." };
  await notifyMany(
    course.instructorIds.filter((id) => id !== user.id),
    {
      type: "system",
      subject: `Changes requested on ${course.title}`,
      message: message || "A moderator reviewed your course and asked for changes before it can be published.",
      link: `/admin/courses/${course.id}`,
      fromUserId: user.id,
    },
  );
  revalidateCourse(next);
  return { ok: true, data: undefined, message: "Course sent back to the instructors" };
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export async function deleteCourseAction(courseId: string): Promise<ActionResult> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  const id = course.id;

  await mutate((db) => {
    const lessonIds = new Set(db.lessons.filter((l) => l.courseId === id).map((l) => l.id));
    const topicIds = new Set(
      db.discussionTopics
        .filter((t) => t.courseId === id || (t.refType === "course" && t.refId === id) || (t.refType === "lesson" && lessonIds.has(t.refId)))
        .map((t) => t.id),
    );
    const unlink = <T extends { courseId?: string; lessonId?: string }>(row: T): T => {
      const copy = { ...row };
      if (copy.courseId === id) delete copy.courseId;
      if (copy.lessonId && lessonIds.has(copy.lessonId)) delete copy.lessonId;
      return copy;
    };

    db.courses = db.courses
      .filter((c) => c.id !== id)
      .map((c) => (c.relatedCourseIds.includes(id) ? { ...c, relatedCourseIds: c.relatedCourseIds.filter((r) => r !== id) } : c))
      // A deleted course can no longer be a prerequisite of another course.
      .map((c) => (c.prerequisiteCourseIds?.includes(id) ? { ...c, prerequisiteCourseIds: c.prerequisiteCourseIds.filter((p) => p !== id) } : c));
    db.chapters = db.chapters.filter((c) => c.courseId !== id);
    db.lessons = db.lessons.filter((l) => l.courseId !== id);
    db.enrollments = db.enrollments.filter((e) => e.courseId !== id);
    db.progress = db.progress.filter((p) => p.courseId !== id);
    db.videoWatches = db.videoWatches.filter((w) => w.courseId !== id);
    db.notes = db.notes.filter((n) => n.courseId !== id);
    db.reviews = db.reviews.filter((r) => r.courseId !== id);
    db.certificates = db.certificates.filter((c) => c.courseId !== id);
    db.certificateRequests = db.certificateRequests.filter((c) => c.courseId !== id);
    db.certificateEvaluations = db.certificateEvaluations.filter((c) => c.courseId !== id);
    db.announcements = db.announcements.filter((a) => a.courseId !== id);
    db.discussionTopics = db.discussionTopics.filter((t) => !topicIds.has(t.id));
    db.discussionReplies = db.discussionReplies.filter((r) => !topicIds.has(r.topicId));
    // Assessments survive the course; they are only unlinked.
    db.quizzes = db.quizzes.map(unlink);
    db.quizSubmissions = db.quizSubmissions.map(unlink);
    db.assignments = db.assignments.map(unlink);
    db.assignmentSubmissions = db.assignmentSubmissions.map(unlink);
    db.exercises = db.exercises.map(unlink);
    db.exerciseSubmissions = db.exerciseSubmissions.map(unlink);
    db.batches = db.batches.map((b) =>
      b.courseIds.includes(id) || b.timetable.some((t) => (t.type === "course" && t.refId === id) || (t.type === "lesson" && t.refId && lessonIds.has(t.refId)))
        ? {
            ...b,
            courseIds: b.courseIds.filter((c) => c !== id),
            timetable: b.timetable.filter((t) => !((t.type === "course" && t.refId === id) || (t.type === "lesson" && t.refId && lessonIds.has(t.refId)))),
          }
        : b,
    );
    db.programs = db.programs.map((p) => (p.courseIds.includes(id) ? { ...p, courseIds: p.courseIds.filter((c) => c !== id) } : p));
    db.coupons = db.coupons.map((c) =>
      c.applicableItems.some((i) => i.type === "course" && i.id === id) ? { ...c, applicableItems: c.applicableItems.filter((i) => !(i.type === "course" && i.id === id)) } : c,
    );
  });

  await audit(user, "course.delete", { type: "course", id }, { title: course.title, slug: course.slug });
  revalidateCourse(course);
  revalidatePath("/batches");
  revalidatePath("/programs");
  await setFlash("Course deleted successfully");
  redirect("/admin/courses");
}

/* ------------------------------------------------------------------ */
/* Categories (inline create)                                          */
/* ------------------------------------------------------------------ */

export async function createCategoryAction(name: string): Promise<ActionResult<Category>> {
  const user = await getCurrentUser();
  if (!user || !canCreateCourses(user)) return { ok: false, error: "Unable to create category" };
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (clean.length < 2) return { ok: false, error: "Category names need at least 2 characters." };
  if (clean.length > 50) return { ok: false, error: "Keep category names under 50 characters." };
  const db = await getDb();
  const existing = db.categories.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { ok: true, data: existing, message: "Category already exists" };
  const category: Category = { id: uid("cat"), name: clean, slug: uniqueSlug(clean, db.categories.map((c) => c.slug)) };
  await insert("categories", category);
  revalidatePath("/courses");
  revalidatePath("/admin/courses", "layout");
  return { ok: true, data: category, message: "Category created successfully" };
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

const MEMBER_TYPES: MemberType[] = ["student", "mentor", "staff"];

export async function searchEnrollCandidatesAction(courseId: string, query: string): Promise<ActionResult<EnrollCandidate[]>> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const q = typeof query === "string" ? query.slice(0, 100) : "";
  return { ok: true, data: await searchEnrollCandidates(loaded.course, q) };
}

export async function enrollStudentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const loaded = await loadManageable(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: "Your role can't add learners to this course." };
  const { user: manager, course } = loaded;
  const db = await getDb();

  const userId = fd(formData, "userId");
  const memberTypeRaw = fd(formData, "memberType") as MemberType;
  const memberType: MemberType = MEMBER_TYPES.includes(memberTypeRaw) ? memberTypeRaw : "student";
  const purchasedCertificate = course.paidCertificate && fdBool(formData, "purchasedCertificate");
  const paymentId = fd(formData, "paymentId");

  const fieldErrors: Record<string, string> = {};
  const student = db.users.find((u) => u.id === userId);
  if (!userId || !student) fieldErrors.userId = "Please select a student to enroll.";
  else if (!student.enabled) fieldErrors.userId = "This account is disabled.";
  else if (db.enrollments.some((e) => e.userId === userId && e.courseId === course.id)) fieldErrors.userId = "Student is already enrolled in this course.";
  if (purchasedCertificate) {
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!paymentId || !payment) fieldErrors.paymentId = "Choose the payment that covers this certificate purchase.";
    else if (payment.userId !== userId || payment.itemId !== course.id) fieldErrors.paymentId = "This payment belongs to another student or item.";
  }
  if (Object.keys(fieldErrors).length || !student) {
    return { ok: false, error: fieldErrors.userId ?? fieldErrors.paymentId ?? "Please fix the errors below.", fieldErrors };
  }

  const enrollment = await enrollUserInCourse(student.id, course.id, {
    memberType,
    paymentId: purchasedCertificate ? paymentId : undefined,
    notifyInstructors: false,
  });
  if (purchasedCertificate) {
    await mutate((d) => {
      const row = d.enrollments.find((e) => e.id === enrollment.id);
      if (row) {
        row.purchasedCertificate = true;
        row.paymentId = paymentId;
      }
    });
  }
  await audit(manager, "enrollment.create", { type: "enrollment", id: enrollment.id }, {
    courseId: course.id,
    courseTitle: course.title,
    userId: student.id,
    memberType,
    purchasedCertificate,
  });
  await notify(student.id, {
    type: "enrollment",
    subject: `You have been enrolled in ${course.title}`,
    message: `${manager.name} added you to the course.`,
    link: `/courses/${course.slug}`,
    fromUserId: manager.id,
  });
  revalidateCourse(course);
  return { ok: true, data: undefined, message: "Student enrolled successfully" };
}

export async function removeStudentAction(courseId: string, userId: string): Promise<ActionResult> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, user: manager } = loaded;
  const db = await getDb();
  const enrollment = db.enrollments.find((e) => e.courseId === course.id && e.userId === userId);
  if (!enrollment) return { ok: false, error: "This student is not enrolled in the course." };
  await unenrollUserFromCourse(userId, course.id);
  await audit(manager, "enrollment.delete", { type: "enrollment", id: enrollment.id }, {
    courseId: course.id,
    courseTitle: course.title,
    userId,
    progress: enrollment.progress,
    paid: !!enrollment.paymentId,
  });
  revalidateCourse(course);
  return { ok: true, data: undefined, message: "Student removed from the course" };
}

export async function getStudentProgressAction(courseId: string, userId: string): Promise<ActionResult<StudentProgressDetail>> {
  const loaded = await loadManageable(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (!hasRole(loaded.user, "course_creator", "moderator")) return { ok: false, error: "You do not have permission to view student progress." };
  const detail = await getStudentProgressDetail(loaded.course, userId);
  if (!detail) return { ok: false, error: "This student is no longer enrolled." };
  return { ok: true, data: detail };
}
