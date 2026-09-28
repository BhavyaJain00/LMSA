import "server-only";
import type { Course, Database, Program, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { hasRole, isModerator, toPublicUser } from "@/lib/auth/session";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import type {
  AdminProgramCourse,
  AdminProgramTab,
  ProgramCourseView,
  ProgramListTab,
  ProgramMemberView,
  ProgramSummary,
} from "@/components/programs/types";
import type { Option } from "@/components/batches/types";

type Viewer = Pick<User, "id" | "roles"> | null | undefined;

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/** Moderators and course creators can author programs. */
export function canCreateProgram(user: Viewer): boolean {
  return hasRole(user, "moderator", "course_creator");
}

/** Moderators manage every program; course creators manage the programs they created. */
export function canManageProgram(user: Viewer, program: Pick<Program, "createdById">): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  return hasRole(user, "course_creator") && program.createdById === user.id;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/** Program progress = average course progress across the program's courses. */
export function computeProgramProgress(db: Database, program: Program, userId: string): number {
  if (!program.courseIds.length) return 0;
  const values = program.courseIds.map((cid) => db.enrollments.find((e) => e.userId === userId && e.courseId === cid)?.progress ?? 0);
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* ------------------------------------------------------------------ */
/* Lookups & summaries                                                 */
/* ------------------------------------------------------------------ */

export async function getProgramBySlug(slug: string): Promise<Program | null> {
  const db = await getDb();
  return db.programs.find((p) => p.slug === slug) ?? null;
}

export async function getProgramById(id: string): Promise<Program | null> {
  const db = await getDb();
  return db.programs.find((p) => p.id === id) ?? null;
}

export function buildProgramSummary(db: Database, program: Program, viewer: Viewer): ProgramSummary {
  const members = db.programMembers.filter((m) => m.programId === program.id);
  const isMember = !!viewer && members.some((m) => m.userId === viewer.id);
  const courseTitles = program.courseIds.map((id) => db.courses.find((c) => c.id === id)?.title).filter((t): t is string => !!t);
  return {
    ...program,
    courseCount: courseTitles.length,
    memberCount: members.length,
    isMember,
    progress: isMember && viewer ? computeProgramProgress(db, program, viewer.id) : null,
    courseTitles,
  };
}

export async function getProgramSummaries(viewer: Viewer, query: { tab: ProgramListTab; search?: string }): Promise<ProgramSummary[]> {
  const db = await getDb();
  const search = query.search?.trim().toLowerCase();
  return db.programs
    .map((p) => buildProgramSummary(db, p, viewer))
    .filter((p) => {
      if (query.tab === "enrolled" && !p.isMember) return false;
      if (query.tab === "published" && !p.published) return false;
      if (search && !`${p.title} ${p.description ?? ""} ${p.courseTitles.join(" ")}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProgramTabCounts(viewer: Viewer): Promise<Record<ProgramListTab, number>> {
  const db = await getDb();
  const summaries = db.programs.map((p) => buildProgramSummary(db, p, viewer));
  return {
    published: summaries.filter((p) => p.published).length,
    enrolled: summaries.filter((p) => p.isMember).length,
  };
}

export async function getAdminProgramSummaries(viewer: User, query: { tab: AdminProgramTab; search?: string }): Promise<ProgramSummary[]> {
  const db = await getDb();
  const search = query.search?.trim().toLowerCase();
  return db.programs
    .filter((p) => canManageProgram(viewer, p))
    .filter((p) => (query.tab === "published" ? p.published : !p.published))
    .filter((p) => !search || p.title.toLowerCase().includes(search))
    .map((p) => buildProgramSummary(db, p, viewer))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAdminProgramTabCounts(viewer: User): Promise<Record<AdminProgramTab, number>> {
  const db = await getDb();
  const mine = db.programs.filter((p) => canManageProgram(viewer, p));
  return { published: mine.filter((p) => p.published).length, unpublished: mine.filter((p) => !p.published).length };
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ordered course list for a program with per-viewer progress and eligibility.
 * The first course is always eligible; with `enforceCourseOrder`, every later
 * course becomes eligible only when the previous one is 100% complete.
 */
export async function getProgramCourses(program: Program, viewer: User | null): Promise<ProgramCourseView[]> {
  const db = await getDb();
  const courses = program.courseIds.map((id) => db.courses.find((c) => c.id === id)).filter((c): c is Course => !!c);
  const out: ProgramCourseView[] = [];
  let previousComplete = true;
  for (const [index, course] of courses.entries()) {
    const enrollment = viewer ? db.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id) : undefined;
    const completed = !!enrollment && (enrollment.progress >= 100 || !!enrollment.completedAt);
    const eligible = !program.enforceCourseOrder || index === 0 || previousComplete;
    let continueHref: string | null = null;
    if (enrollment && viewer && eligible) {
      const next = await getNextLesson(course, viewer);
      if (next) continueHref = lessonHref(course.slug, next);
    }
    out.push({
      id: course.id,
      slug: course.slug,
      title: course.title,
      shortIntroduction: course.shortIntroduction,
      imageUrl: course.imageUrl,
      cardGradient: course.cardGradient,
      published: course.published,
      lessonCount: db.lessons.filter((l) => l.courseId === course.id).length,
      enrollmentCount: db.enrollments.filter((e) => e.courseId === course.id && e.memberType === "student").length,
      instructors: course.instructorIds
        .map((id) => db.users.find((u) => u.id === id))
        .filter((u): u is User => !!u)
        .map(toPublicUser),
      position: index + 1,
      enrolled: !!enrollment,
      progress: enrollment ? Math.round(enrollment.progress) : null,
      completed,
      eligible,
      continueHref,
    });
    previousComplete = completed;
  }
  return out;
}

export async function getProgramSummary(program: Program, viewer: Viewer): Promise<ProgramSummary> {
  const db = await getDb();
  return buildProgramSummary(db, program, viewer);
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export async function getProgramMembers(program: Program): Promise<ProgramMemberView[]> {
  const db = await getDb();
  return db.programMembers
    .filter((m) => m.programId === program.id)
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .map((m): ProgramMemberView | null => {
      const user = db.users.find((u) => u.id === m.userId);
      if (!user) return null;
      const courses = program.courseIds
        .map((cid) => db.courses.find((c) => c.id === cid))
        .filter((c): c is Course => !!c)
        .map((c) => {
          const e = db.enrollments.find((x) => x.userId === user.id && x.courseId === c.id);
          return { courseId: c.id, title: c.title, progress: e ? Math.round(e.progress) : 0, enrolled: !!e };
        });
      return {
        id: m.id,
        userId: user.id,
        user: toPublicUser(user),
        progress: computeProgramProgress(db, program, user.id),
        joinedAt: m.joinedAt,
        courses,
        completedCourses: courses.filter((c) => c.progress >= 100).length,
      };
    })
    .filter((m): m is ProgramMemberView => !!m);
}

export async function getAdminProgramCourses(program: Program): Promise<AdminProgramCourse[]> {
  const db = await getDb();
  return program.courseIds
    .map((id) => db.courses.find((c) => c.id === id))
    .filter((c): c is Course => !!c)
    .map((c) => ({ id: c.id, title: c.title, slug: c.slug, published: c.published, lessonCount: db.lessons.filter((l) => l.courseId === c.id).length }));
}

/** Courses that can be added to a program. */
export async function getProgramCourseOptions(program: Program, viewer: User): Promise<Option[]> {
  const db = await getDb();
  return db.courses
    .filter((c) => !program.courseIds.includes(c.id))
    .filter((c) => c.published || isModerator(viewer) || c.instructorIds.includes(viewer.id) || c.createdById === viewer.id)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => ({ value: c.id, label: c.title, hint: c.published ? undefined : "Unpublished" }));
}

/** Enabled users who are not yet members. */
export async function getProgramMemberCandidates(program: Program): Promise<Option[]> {
  const db = await getDb();
  const members = new Set(db.programMembers.filter((m) => m.programId === program.id).map((m) => m.userId));
  return db.users
    .filter((u) => u.enabled && !members.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: u.id, label: u.name, hint: u.email }));
}
