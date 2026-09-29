"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Database, Program, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { canCreateProgram, canManageProgram, computeProgramProgress, programCourseAccess } from "@/lib/data/programs";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import { enrollUserInCourse } from "@/lib/services/enrollment";
import { notify } from "@/lib/services/notifications";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, slugify, uid, uniqueSlug } from "@/lib/utils";

type Guard = { ok: true; user: User; program: Program; db: Database } | { ok: false; error: string };

async function guardProgram(programId: string): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const program = db.programs.find((p) => p.id === programId);
  if (!program) return { ok: false, error: "This program no longer exists." };
  if (!canManageProgram(user, program)) return { ok: false, error: "You are not permitted to manage programs." };
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

/**
 * Enroll a member in the courses they may start: only the first course when
 * the order is enforced (later ones unlock as they finish), otherwise all.
 */
/**
 * Enroll a program member in the program's starting course(s). Managers adding
 * members grant access directly; a learner joining on their own (`self`) is
 * only enrolled in courses they could open anyway (published, and free or
 * already paid for). Paid courses stay behind checkout.
 */
async function enrollMemberInCourses(program: Program, userId: string, opts: { self?: User } = {}) {
  const ids = program.enforceCourseOrder ? program.courseIds.slice(0, 1) : program.courseIds;
  const db = opts.self ? await getDb() : null;
  for (const courseId of ids) {
    if (db && opts.self) {
      const course = db.courses.find((c) => c.id === courseId);
      if (!course) continue;
      const access = programCourseAccess(db, opts.self, course);
      if (!access.ok) continue;
      await enrollUserInCourse(userId, courseId, { notifyInstructors: false, paymentId: access.paymentId });
    } else {
      await enrollUserInCourse(userId, courseId, { notifyInstructors: false });
    }
  }
  await mutate((d) => refreshMemberProgress(d, program.id));
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

export async function createProgramAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canCreateProgram(user)) return { ok: false, error: "You are not permitted to manage programs." };
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

export async function updateProgramAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardProgram(fd(formData, "programId"));
  if (!guard.ok) return guard;
  const { program, db } = guard;
  const { fieldErrors, values } = parseProgramForm(formData, db, program);
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };
  const orderChanged = program.enforceCourseOrder !== values.enforceCourseOrder;
  await mutate((d) => {
    const row = d.programs.find((p) => p.id === program.id);
    if (row) Object.assign(row, values, { updatedAt: new Date().toISOString() });
  });
  // Lifting the order restriction gives existing members access to every course.
  if (orderChanged && !values.enforceCourseOrder) {
    const members = db.programMembers.filter((m) => m.programId === program.id);
    for (const m of members) await enrollMemberInCourses({ ...program, ...values }, m.userId);
  }
  if (program.slug !== values.slug) revalidatePath(`/programs/${program.slug}`);
  revalidateProgram({ id: program.id, slug: values.slug });
  return { ok: true, data: undefined, message: "Program updated successfully" };
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

export async function addProgramCourseAction(programId: string, courseId: string): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program, db, user } = guard;
  if (!courseId) return { ok: false, error: "Please select a course" };
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
  if (!program.enforceCourseOrder) {
    for (const m of db.programMembers.filter((x) => x.programId === program.id)) {
      await enrollUserInCourse(m.userId, course.id, { notifyInstructors: false });
    }
    await mutate((d) => refreshMemberProgress(d, program.id));
  }
  revalidateProgram(program);
  return { ok: true, data: undefined, message: "Course added to program successfully" };
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

export async function addProgramMemberAction(programId: string, userId: string): Promise<ActionResult> {
  const guard = await guardProgram(programId);
  if (!guard.ok) return guard;
  const { program, db, user: actor } = guard;
  if (!userId) return { ok: false, error: "Please select a member" };
  const user = db.users.find((u) => u.id === userId && u.enabled);
  if (!user) return { ok: false, error: "Please select a member" };
  if (db.programMembers.some((m) => m.programId === program.id && m.userId === user.id)) return { ok: false, error: "Member already added to program" };
  await mutate((d) => {
    d.programMembers.push({ id: uid("pm"), programId: program.id, userId: user.id, progress: 0, joinedAt: new Date().toISOString() });
  });
  await enrollMemberInCourses(program, user.id);
  await notify(user.id, {
    type: "enrollment",
    subject: `You were added to the program ${program.title}`,
    message: program.description,
    link: `/programs/${program.slug}`,
    fromUserId: actor.id,
  });
  revalidateProgram(program);
  return { ok: true, data: undefined, message: "Member added to program successfully" };
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
    await setFlash("Please log in to enroll in this program.", "warning");
    redirect(`/login?next=${encodeURIComponent(`/programs/${program.slug}`)}`);
  }
  if (!db.settings.features.programs) return { ok: false, error: "Programs are currently disabled on this platform." };
  if (!program.published && !canManageProgram(user, program)) return { ok: false, error: "You cannot enroll in an unpublished program." };
  if (!program.courseIds.length) return { ok: false, error: "This program has no courses yet." };
  const existing = db.programMembers.some((m) => m.programId === program.id && m.userId === user.id);
  if (!existing) {
    await mutate((d) => {
      if (!d.programMembers.some((m) => m.programId === program.id && m.userId === user.id)) {
        d.programMembers.push({ id: uid("pm"), programId: program.id, userId: user.id, progress: 0, joinedAt: new Date().toISOString() });
      }
    });
    await enrollMemberInCourses(program, user.id, { self: user });
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
    if (!prev || (prev.progress < 100 && !prev.completedAt)) return { ok: false, error: "Please complete the previous course to unlock this one." };
  }
  const access = programCourseAccess(db, user, course);
  if (!access.ok) {
    if (access.reason === "payment") redirect(`/billing/course/${course.id}`);
    return { ok: false, error: "This course is not available yet." };
  }
  await enrollUserInCourse(user.id, course.id, { notifyInstructors: true, paymentId: access.paymentId });
  await mutate((d) => refreshMemberProgress(d, program.id));
  revalidateProgram(program);
  revalidatePath(`/courses/${course.slug}`);
  const next = await getNextLesson(course, user);
  redirect(next ? lessonHref(course.slug, next) : `/courses/${course.slug}`);
}
