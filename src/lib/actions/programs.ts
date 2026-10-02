"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Course, Database, Program, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { canCreateProgram, canManageProgram, computeProgramProgress, managedCourseAccess, programCourseAccess } from "@/lib/data/programs";
import { canManageCourse, getNextLesson, lessonHref } from "@/lib/data/courses";
import { assertPrerequisitesMet } from "@/lib/services/drip";
import { verificationError } from "@/lib/auth/verification";
import { enrollUserInCourse } from "@/lib/services/enrollment";
import { notify } from "@/lib/services/notifications";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, slugify, uid, uniqueSlug } from "@/lib/utils";
import { needsPurchaseText, type ProgramEnrollOptions, type ProgramEnrollmentReport } from "@/components/programs/types";

type Guard = { ok: true; user: User; program: Program; db: Database } | { ok: false; error: string };

async function guardProgram(programId: string): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const program = db.programs.find((p) => p.id === programId);
  if (!program) return { ok: false, error: "This program no longer exists." };
  if (!canManageProgram(user, program)) return { ok: false, error: "Your role can't manage programs." };
  return { ok: true, user, program, db };
}

function revalidateProgram(program: Pick<Program, "id" | "slug">) {
  revalidatePath("/programs");
  revalidatePath(`/programs/${program.slug}`);
  revalidatePath("/admin/programs");
  revalidatePath(`/admin/programs/${program.id}`);
  revalidatePath("/dashboard");
}

/** Recompute stored program progress for every member (after course list changes). */
function refreshMemberProgress(d: Database, programId: string) {
  const program = d.programs.find((p) => p.id === programId);
  if (!program) return;
  for (const m of d.programMembers) {
    if (m.programId === programId) m.progress = computeProgramProgress(d, program, m.userId);
  }
}

/** The courses a program member starts with: the first one when the order is enforced (later ones unlock as they finish), otherwise all. */
function startingCourseIds(program: Pick<Program, "courseIds" | "enforceCourseOrder">): string[] {
  return program.enforceCourseOrder ? program.courseIds.slice(0, 1) : program.courseIds;
}

/**
 * Enroll a learner who joined a program on their own in its starting
 * course(s), limited to courses they could open anyway (published, and free
 * or already paid for: paid courses stay behind checkout) whose prerequisites
 * they have completed. The rest they start from the program page
 * (`startProgramCourseAction`).
 */
async function enrollSelfInStartingCourses(program: Program, self: User): Promise<void> {
  const db = await getDb();
  for (const courseId of startingCourseIds(program)) {
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) continue;
    const access = programCourseAccess(db, self, course);
    if (!access.ok) continue;
    if (await prerequisiteError(db, self, course)) continue;
    await enrollUserInCourse(self.id, courseId, { notifyInstructors: false, paymentId: access.paymentId });
  }
  await mutate((d) => refreshMemberProgress(d, program.id));
}

/**
 * Enroll program members in courses on a manager's behalf (adding a member or
 * a course, lifting the course order). Program membership waives neither a
 * course's price nor its prerequisites:
 *  - a paid course needs the member's paid order (the enrollment is linked to
 *    it). Members without one are skipped and reported ("N members need to
 *    purchase …") unless the manager explicitly ticked "Grant access without
 *    payment" and manages that course (see `managedCourseAccess`);
 *  - members who haven't completed a course's prerequisites are skipped and
 *    start it from the program page once they have
 *    (`startProgramCourseAction` checks again).
 * Members already enrolled are left as they are.
 */
async function enrollMembersAsManager(
  program: Program,
  actor: User,
  userIds: string[],
  courseIds: string[],
  options: ProgramEnrollOptions,
): Promise<ProgramEnrollmentReport> {
  const db = await getDb();
  const grantPaidAccess = options.grantPaidAccess === true;
  const report: ProgramEnrollmentReport = { enrolled: 0, granted: 0, needsPurchase: [], waitingOnPrerequisites: 0 };
  for (const courseId of courseIds) {
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) continue;
    let unpaid = 0;
    for (const userId of userIds) {
      const member = db.users.find((u) => u.id === userId);
      if (!member || db.enrollments.some((e) => e.userId === member.id && e.courseId === course.id)) continue;
      const access = managedCourseAccess(db, actor, member, course, grantPaidAccess);
      if (!access.ok) {
        unpaid++;
        continue;
      }
      if (await prerequisiteError(db, member, course)) {
        report.waitingOnPrerequisites++;
        continue;
      }
      await enrollUserInCourse(member.id, course.id, { notifyInstructors: false, paymentId: access.paymentId });
      report.enrolled++;
      if (access.granted) report.granted++;
    }
    if (unpaid) report.needsPurchase.push({ courseId: course.id, title: course.title, members: unpaid });
  }
  await mutate((d) => refreshMemberProgress(d, program.id));
  return report;
}

/** Enroll options sent by the admin screens; only an explicit `true` grants paid access. */
function parseEnrollOptions(options: unknown): ProgramEnrollOptions {
  const grant = !!options && typeof options === "object" && (options as { grantPaidAccess?: unknown }).grantPaidAccess === true;
  return { grantPaidAccess: grant };
}

/** Success message: the headline plus who still needs to buy a course or finish prerequisites. */
function reportMessage(headline: string, report: ProgramEnrollmentReport, waiting: (count: number) => string): string {
  const notes = report.needsPurchase.map((item) => `${needsPurchaseText(item)}.`);
  if (report.waitingOnPrerequisites) notes.push(waiting(report.waitingOnPrerequisites));
  return notes.length ? `${headline}. ${notes.join(" ")}` : headline;
}

/**
 * Why a program member can't be enrolled in `course` yet: unmet course
 * prerequisites (already enrolled learners and course managers are exempt).
 * Program paths never waive prerequisites; a course manager who wants to can
 * enroll the learner directly from the course's admin page.
 */
async function prerequisiteError(db: Database, user: User, course: Course): Promise<string | null> {
  if (db.enrollments.some((e) => e.userId === user.id && e.courseId === course.id)) return null;
  if (canManageCourse(user, course)) return null;
  const gate = await assertPrerequisitesMet(user.id, course.id);
  return gate.ok ? null : gate.error;
}

function parseProgramForm(formData: FormData, db: Database, existing: Program | null) {
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const description = fd(formData, "description");
  const slugInput = fd(formData, "slug");
  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Add a title for the program.";
  else if (title.length > 140) fieldErrors.title = "Keep the title under 140 characters.";
  if (description.length > 2000) fieldErrors.description = "Keep the description under 2,000 characters.";
  let slug = existing ? slugify(slugInput || title || "program") : uniqueSlug(title || "program", db.programs.map((p) => p.slug));
  if (existing) {
    if (slugInput && slugInput !== slug) fieldErrors.slug = `Use lowercase letters, numbers and dashes, e.g. "${slug}".`;
    else if (db.programs.some((p) => p.slug === slug && p.id !== existing.id)) fieldErrors.slug = "Another program already uses this URL.";
  } else if (!title) {
    slug = "";
  }
  if (!fieldErrors.title && db.programs.some((p) => p.id !== existing?.id && p.title.toLowerCase() === title.toLowerCase())) {
    fieldErrors.title = "A program with this title already exists.";
  }
  return {
    fieldErrors,
    values: {
      title,
      slug,
      description: description || undefined,
      published: fdBool(formData, "published"),
      enforceCourseOrder: fdBool(formData, "enforceCourseOrder"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function createProgramAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canCreateProgram(user)) return { ok: false, error: "Your role can't manage programs." };
  const db = await getDb();
  const { fieldErrors, values } = parseProgramForm(formData, db, null);
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };
  const now = new Date().toISOString();
  const program: Program = { ...values, id: uid("prg"), courseIds: [], createdById: user.id, createdAt: now, updatedAt: now };
  await mutate((d) => {
    program.slug = uniqueSlug(program.title, d.programs.map((p) => p.slug));
    d.programs.push(program);
  });
  revalidateProgram(program);
  await setFlash("Program created successfully", "success");
  redirect(`/admin/programs/${program.id}`);
}

/**
 * Save a program's details. Lifting the course order enrolls the existing
 * members in every course; paid courses only for members who bought them,
 * unless the form's "Grant access without payment" box (`grantPaidAccess`)
 * is ticked. The report lists who still needs to purchase a course.
 */
export async function updateProgramAction(_prev: unknown, formData: FormData): Promise<ActionResult<ProgramEnrollmentReport | undefined>> {
  const guard = await guardProgram(fd(formData, "programId"));
  if (!guard.ok) return guard;
  const { program, db, user } = guard;
  const { fieldErrors, values } = parseProgramForm(formData, db, program);
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };
  const orderChanged = program.enforceCourseOrder !== values.enforceCourseOrder;
  await mutate((d) => {
    const row = d.programs.find((p) => p.id === program.id);
    if (row) Object.assign(row, values, { updatedAt: new Date().toISOString() });
  });
  // Lifting the order restriction gives existing members access to every course (paid ones as described above).
  let report: ProgramEnrollmentReport | undefined;
  if (orderChanged && !values.enforceCourseOrder) {
    const memberIds = db.programMembers.filter((m) => m.programId === program.id).map((m) => m.userId);
    report = await enrollMembersAsManager({ ...program, ...values }, user, memberIds, program.courseIds, { grantPaidAccess: fdBool(formData, "grantPaidAccess") });
  }
  if (program.slug !== values.slug) revalidatePath(`/programs/${program.slug}`);
  revalidateProgram({ id: program.id, slug: values.slug });
  const message = report
    ? reportMessage("Program updated successfully", report, (n) => `${n === 1 ? "One course enrollment waits" : `${n} course enrollments wait`} for members to complete prerequisites.`)
    : "Program updated successfully";
  return { ok: true, data: report, message };
}

export async function deleteProgramAction(programId: string): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program } = guard;
  await mutate((d) => {
    d.programs = d.programs.filter((p) => p.id !== program.id);
    d.programMembers = d.programMembers.filter((m) => m.programId !== program.id);
  });
  revalidateProgram(program);
  await setFlash("Program deleted successfully", "success");
  redirect("/admin/programs");
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

/**
 * Add a course to a program. Without an enforced order, existing members are
 * enrolled in it right away: for a paid course only those who bought it,
 * unless `options.grantPaidAccess` (the "Grant access without payment" box)
 * is set and the manager manages the course. The report says how many members
 * need to purchase it.
 */
export async function addProgramCourseAction(programId: string, courseId: string, options?: ProgramEnrollOptions): Promise<ActionResult<ProgramEnrollmentReport>> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program, db, user } = guard;
  if (!courseId || typeof courseId !== "string") return { ok: false, error: "Please select a course" };
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, error: "Please select a course" };
  if (program.courseIds.includes(course.id)) return { ok: false, error: "Course already added to program" };
  if (!course.published && !isModerator(user) && !course.instructorIds.includes(user.id) && course.createdById !== user.id) {
    return { ok: false, error: "Only published courses can be added to a program." };
  }
  await mutate((d) => {
    const row = d.programs.find((p) => p.id === program.id);
    if (!row) return;
    row.courseIds.push(course.id);
    row.updatedAt = new Date().toISOString();
    refreshMemberProgress(d, program.id);
  });
  let report: ProgramEnrollmentReport = { enrolled: 0, granted: 0, needsPurchase: [], waitingOnPrerequisites: 0 };
  if (!program.enforceCourseOrder) {
    const memberIds = db.programMembers.filter((m) => m.programId === program.id).map((m) => m.userId);
    report = await enrollMembersAsManager(program, user, memberIds, [course.id], parseEnrollOptions(options));
  }
  revalidateProgram(program);
  const message = reportMessage("Course added to program successfully", report, (n) => `${n === 1 ? "One member" : `${n} members`} can start it once they complete its prerequisites.`);
  return { ok: true, data: report, message };
}

export async function removeProgramCourseAction(programId: string, courseId: string): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program } = guard;
  if (!program.courseIds.includes(courseId)) return { ok: false, error: "This course is not part of the program." };
  await mutate((d) => {
    const row = d.programs.find((p) => p.id === program.id);
    if (!row) return;
    row.courseIds = row.courseIds.filter((id) => id !== courseId);
    row.updatedAt = new Date().toISOString();
    refreshMemberProgress(d, program.id);
  });
  revalidateProgram(program);
  return { ok: true, data: undefined, message: "Course removed from program" };
}

export async function moveProgramCourseAction(programId: string, courseId: string, direction: "up" | "down"): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program } = guard;
  const index = program.courseIds.indexOf(courseId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= program.courseIds.length) return { ok: false, error: "This course cannot be moved further." };
  await mutate((d) => {
    const row = d.programs.find((p) => p.id === program.id);
    if (!row) return;
    const ids = [...row.courseIds];
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    row.courseIds = ids;
    row.updatedAt = new Date().toISOString();
  });
  revalidateProgram(program);
  return { ok: true, data: undefined };
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

/**
 * Add a member to a program and enroll them in its starting course(s): paid
 * courses only when they bought them, unless `options.grantPaidAccess` (the
 * "Grant access without payment" box) is set and the manager manages the
 * course. The report says which courses they still need to purchase.
 */
export async function addProgramMemberAction(programId: string, userId: string, options?: ProgramEnrollOptions): Promise<ActionResult<ProgramEnrollmentReport>> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program, db, user: actor } = guard;
  if (!userId || typeof userId !== "string") return { ok: false, error: "Please select a member" };
  const user = db.users.find((u) => u.id === userId && u.enabled);
  if (!user) return { ok: false, error: "Please select a member" };
  if (db.programMembers.some((m) => m.programId === program.id && m.userId === user.id)) return { ok: false, error: "Member already added to program" };
  await mutate((d) => {
    d.programMembers.push({ id: uid("pm"), programId: program.id, userId: user.id, progress: 0, joinedAt: new Date().toISOString() });
  });
  const report = await enrollMembersAsManager(program, actor, [user.id], startingCourseIds(program), parseEnrollOptions(options));
  await notify(user.id, {
    type: "enrollment",
    subject: `You were added to the program ${program.title}`,
    message: program.description,
    link: `/programs/${program.slug}`,
    fromUserId: actor.id,
  });
  revalidateProgram(program);
  const message = reportMessage(
    "Member added to program successfully",
    report,
    (n) => `${n === 1 ? "One course" : `${n} courses`} can be started once the member completes the prerequisites.`,
  );
  return { ok: true, data: report, message };
}

export async function removeProgramMemberAction(programId: string, userId: string): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program, db } = guard;
  if (!db.programMembers.some((m) => m.programId === program.id && m.userId === userId)) return { ok: false, error: "This member is not part of the program." };
  await mutate((d) => {
    d.programMembers = d.programMembers.filter((m) => !(m.programId === program.id && m.userId === userId));
  });
  revalidateProgram(program);
  return { ok: true, data: undefined, message: "Member removed from program" };
}

/* ------------------------------------------------------------------ */
/* Learner                                                             */
/* ------------------------------------------------------------------ */

/** Self-enroll the current user in a published program. */
export async function enrollInProgramAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const db = await getDb();
  const program = db.programs.find((p) => p.id === fd(formData, "programId"));
  if (!program) return { ok: false, error: "This program no longer exists." };
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Log in to join this program.", "warning");
    redirect(`/login?next=${encodeURIComponent(`/programs/${program.slug}`)}`);
  }
  if (!db.settings.features.programs) return { ok: false, error: "Programs are currently disabled on this platform." };
  if (!program.published && !canManageProgram(user, program)) return { ok: false, error: "You cannot enroll in an unpublished program." };
  if (!program.courseIds.length) return { ok: false, error: "This program has no courses yet." };
  const existing = db.programMembers.some((m) => m.programId === program.id && m.userId === user.id);
  if (!existing) {
    // Members who must confirm their email can't enroll until they do (Settings → Security).
    const blocked = await verificationError(user);
    if (blocked) return { ok: false, error: blocked };
    await mutate((d) => {
      if (!d.programMembers.some((m) => m.programId === program.id && m.userId === user.id)) {
        d.programMembers.push({ id: uid("pm"), programId: program.id, userId: user.id, progress: 0, joinedAt: new Date().toISOString() });
      }
    });
    await enrollSelfInStartingCourses(program, user);
  }
  revalidateProgram(program);
  await setFlash(existing ? "You are already enrolled in this program" : "Successfully enrolled in program", existing ? "info" : "success");
  redirect(`/programs/${program.slug}`);
}

/**
 * Start the next course of a program once it is unlocked. The program unlocks
 * the order, not the course's own gates: unpublished courses stay closed to
 * learners and paid courses need a completed payment (sent to checkout).
 */
export async function startProgramCourseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const program = db.programs.find((p) => p.id === fd(formData, "programId"));
  if (!program) return { ok: false, error: "This program no longer exists." };
  if (!db.programMembers.some((m) => m.programId === program.id && m.userId === user.id)) {
    return { ok: false, error: "Enroll in the program first." };
  }
  const courseId = fd(formData, "courseId");
  const index = program.courseIds.indexOf(courseId);
  const course = db.courses.find((c) => c.id === courseId);
  if (index === -1 || !course) return { ok: false, error: "This course is not part of the program." };
  if (program.enforceCourseOrder && index > 0) {
    const prevId = program.courseIds[index - 1]!;
    const prev = db.enrollments.find((e) => e.userId === user.id && e.courseId === prevId);
    if (!prev || (prev.progress < 100 && !prev.completedAt)) return { ok: false, error: "Finish the course before this one to open it." };
  }
  const access = programCourseAccess(db, user, course);
  if (!access.ok) {
    if (access.reason === "payment") redirect(`/billing/course/${course.id}`);
    return { ok: false, error: "This course is not available yet." };
  }
  if (!db.enrollments.some((e) => e.userId === user.id && e.courseId === course.id)) {
    const blocked = await verificationError(user);
    if (blocked) return { ok: false, error: blocked };
  }
  const prerequisiteBlock = await prerequisiteError(db, user, course);
  if (prerequisiteBlock) return { ok: false, error: prerequisiteBlock };
  await enrollUserInCourse(user.id, course.id, { notifyInstructors: true, paymentId: access.paymentId, confirmationEmail: !access.paymentId });
  await mutate((d) => refreshMemberProgress(d, program.id));
  revalidateProgram(program);
  revalidatePath(`/courses/${course.slug}`);
  const next = await getNextLesson(course, user);
  redirect(next ? lessonHref(course.slug, next) : `/courses/${course.slug}`);
}
