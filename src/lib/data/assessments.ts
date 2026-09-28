import "server-only";
import type {
  Assignment,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentType,
  Course,
  ExerciseLanguage,
  ExerciseSubmission,
  ProgrammingExercise,
  PublicUser,
  User,
} from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { canManageCourse, getLessonHref } from "@/lib/data/courses";
import { hasRole, isModerator, isStaff, toPublicUser } from "@/lib/auth/session";
import {
  DEFAULT_STARTER_CODE,
  hashOutput,
  type AssignmentSubmissionView,
  type AssignmentView,
  type ExerciseSubmissionView,
  type RunnerExercise,
  type TestResultView,
} from "@/components/assessments/shared";

/**
 * Read models for assignments and programming exercises: admin lists with
 * filters, learner views, grading details and runner payloads.
 */

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/** Staff (creators, moderators, evaluators, admins) manage assignments and grade submissions. */
export function canManageAssessments(user: Pick<User, "roles"> | null | undefined): boolean {
  return isStaff(user);
}

/** Only moderators may bulk-delete learner submissions. */
export function canDeleteSubmissions(user: Pick<User, "roles"> | null | undefined): boolean {
  return isModerator(user);
}

export interface UserLite {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

function lite(user: PublicUser | User | undefined | null): UserLite | null {
  if (!user) return null;
  return { id: user.id, name: user.name, username: user.username, email: user.email, avatarUrl: user.avatarUrl };
}

const unknownUser = (id: string): UserLite => ({ id, name: "Deleted user", username: "", email: "" });

/* ------------------------------------------------------------------ */
/* Shared option lists for filters and forms                           */
/* ------------------------------------------------------------------ */

export interface Option {
  value: string;
  label: string;
}

/**
 * Courses the viewer may attach an assessment to: every course for
 * moderators and evaluators, the courses they manage for creators. The
 * currently linked course is always included so editing never drops it.
 */
export async function getCourseOptions(viewer: User, includeId?: string | null): Promise<Option[]> {
  const db = await getDb();
  const seeAll = isModerator(viewer) || hasRole(viewer, "batch_evaluator");
  return db.courses
    .filter((c) => seeAll || canManageCourse(viewer, c) || c.id === includeId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => ({ value: c.id, label: c.published ? c.title : `${c.title} (unpublished)` }));
}

export async function getMemberOptions(): Promise<Option[]> {
  const db = await getDb();
  return [...db.users]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));
}

export async function getAssignmentOptions(): Promise<Option[]> {
  const db = await getDb();
  return [...db.assignments].sort((a, b) => a.title.localeCompare(b.title)).map((a) => ({ value: a.id, label: a.title }));
}

export async function getExerciseOptions(): Promise<Option[]> {
  const db = await getDb();
  return [...db.exercises].sort((a, b) => a.title.localeCompare(b.title)).map((e) => ({ value: e.id, label: e.title }));
}

/** Where a learner should return after working on an assessment opened from a lesson. */
export async function getReturnLink(lessonId?: string | null, courseId?: string | null): Promise<{ href: string; label: string } | null> {
  const db = await getDb();
  if (lessonId) {
    const href = await getLessonHref(lessonId);
    const lesson = db.lessons.find((l) => l.id === lessonId);
    if (href && lesson) return { href, label: `Back to ${lesson.title}` };
  }
  if (courseId) {
    const course = db.courses.find((c) => c.id === courseId);
    if (course) return { href: `/courses/${course.slug}`, label: `Back to ${course.title}` };
  }
  return null;
}

/** Lessons that embed a given assignment/exercise block. */
export async function getAssessmentUsage(kind: "assignment" | "exercise", refId: string): Promise<{ lessonId: string; lessonTitle: string; courseTitle: string; href: string | null }[]> {
  const db = await getDb();
  const out: { lessonId: string; lessonTitle: string; courseTitle: string; href: string | null }[] = [];
  for (const lesson of db.lessons) {
    const used = lesson.blocks.some((b) => (kind === "assignment" ? b.type === "assignment" && b.assignmentId === refId : b.type === "exercise" && b.exerciseId === refId));
    if (!used) continue;
    const course = db.courses.find((c) => c.id === lesson.courseId);
    out.push({ lessonId: lesson.id, lessonTitle: lesson.title, courseTitle: course?.title ?? "Unknown course", href: await getLessonHref(lesson.id) });
  }
  const batches = db.batches.filter((b) => b.assessments.some((a) => a.type === kind && a.refId === refId));
  for (const b of batches) out.push({ lessonId: b.id, lessonTitle: `Batch assessment`, courseTitle: b.title, href: `/batches/${b.slug}` });
  return out;
}

/* ------------------------------------------------------------------ */
/* Assignments                                                         */
/* ------------------------------------------------------------------ */

export interface AssignmentListRow {
  id: string;
  title: string;
  type: AssignmentType;
  courseTitle: string | null;
  updatedAt: string;
  submissionCount: number;
  pendingCount: number;
  scheduled: boolean;
}

export async function listAssignments(filter: { search?: string; type?: string; courseId?: string } = {}): Promise<AssignmentListRow[]> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const search = filter.search?.trim().toLowerCase();
  const counts = new Map<string, { total: number; pending: number }>();
  for (const s of db.assignmentSubmissions) {
    const entry = counts.get(s.assignmentId) ?? { total: 0, pending: 0 };
    entry.total++;
    if (s.status === "not_graded") entry.pending++;
    counts.set(s.assignmentId, entry);
  }
  return db.assignments
    .filter((a) => {
      if (search && !a.title.toLowerCase().includes(search)) return false;
      if (filter.type && a.type !== filter.type) return false;
      if (filter.courseId && a.courseId !== filter.courseId) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      courseTitle: a.courseId ? (courses.get(a.courseId)?.title ?? null) : null,
      updatedAt: a.updatedAt,
      submissionCount: counts.get(a.id)?.total ?? 0,
      pendingCount: counts.get(a.id)?.pending ?? 0,
      scheduled: a.enableScheduling,
    }));
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  const db = await getDb();
  return db.assignments.find((a) => a.id === id) ?? null;
}

export function toAssignmentView(a: Assignment, opts: { includeAnswer: boolean }): AssignmentView {
  return {
    id: a.id,
    title: a.title,
    question: a.question,
    type: a.type,
    showAnswer: a.showAnswer,
    answer: opts.includeAnswer && a.showAnswer ? a.answer : undefined,
    gradeAssignment: a.gradeAssignment,
    enableScheduling: a.enableScheduling,
    scheduleStart: a.scheduleStart,
    scheduleEnd: a.scheduleEnd,
    courseId: a.courseId,
  };
}

export async function toSubmissionView(s: AssignmentSubmission): Promise<AssignmentSubmissionView> {
  const db = await getDb();
  const evaluator = s.evaluatorId ? db.users.find((u) => u.id === s.evaluatorId) : undefined;
  return {
    id: s.id,
    type: s.type,
    answer: s.answer,
    attachmentUrl: s.attachmentUrl,
    status: s.status,
    comments: s.comments,
    evaluatorName: evaluator?.name,
    gradedAt: s.gradedAt,
    submittedAt: s.submittedAt,
    updatedAt: s.updatedAt,
  };
}

export async function getOwnAssignmentSubmission(userId: string, assignmentId: string): Promise<AssignmentSubmission | null> {
  const db = await getDb();
  return db.assignmentSubmissions.find((s) => s.userId === userId && s.assignmentId === assignmentId) ?? null;
}

export interface AssignmentSubmissionRow {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  user: UserLite;
  courseTitle: string | null;
  type: AssignmentType;
  status: AssignmentStatus;
  submittedAt: string;
  updatedAt: string;
  evaluatorName: string | null;
}

export async function listAssignmentSubmissions(filter: { assignmentId?: string; memberId?: string; status?: string } = {}): Promise<AssignmentSubmissionRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  return db.assignmentSubmissions
    .filter((s) => {
      if (filter.assignmentId && s.assignmentId !== filter.assignmentId) return false;
      if (filter.memberId && s.userId !== filter.memberId) return false;
      if (filter.status && s.status !== filter.status) return false;
      return true;
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((s) => ({
      id: s.id,
      assignmentId: s.assignmentId,
      assignmentTitle: assignments.get(s.assignmentId)?.title ?? s.assignmentTitle,
      user: lite(users.get(s.userId)) ?? unknownUser(s.userId),
      courseTitle: s.courseId ? (courses.get(s.courseId)?.title ?? null) : null,
      type: s.type,
      status: s.status,
      submittedAt: s.submittedAt,
      updatedAt: s.updatedAt,
      evaluatorName: s.evaluatorId ? (users.get(s.evaluatorId)?.name ?? null) : null,
    }));
}

export interface AssignmentSubmissionDetail {
  submission: AssignmentSubmission;
  assignment: Assignment | null;
  user: UserLite;
  evaluator: UserLite | null;
  course: Pick<Course, "id" | "title" | "slug"> | null;
  lessonHref: string | null;
  lessonTitle: string | null;
}

export async function getAssignmentSubmissionDetail(id: string): Promise<AssignmentSubmissionDetail | null> {
  const db = await getDb();
  const submission = db.assignmentSubmissions.find((s) => s.id === id);
  if (!submission) return null;
  const assignment = db.assignments.find((a) => a.id === submission.assignmentId) ?? null;
  const user = db.users.find((u) => u.id === submission.userId);
  const evaluator = submission.evaluatorId ? db.users.find((u) => u.id === submission.evaluatorId) : undefined;
  const courseId = submission.courseId ?? assignment?.courseId;
  const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
  const lesson = submission.lessonId ? db.lessons.find((l) => l.id === submission.lessonId) : undefined;
  return {
    submission,
    assignment,
    user: lite(user) ?? unknownUser(submission.userId),
    evaluator: lite(evaluator),
    course: course ? { id: course.id, title: course.title, slug: course.slug } : null,
    lessonHref: lesson ? await getLessonHref(lesson.id) : null,
    lessonTitle: lesson?.title ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Programming exercises                                               */
/* ------------------------------------------------------------------ */

export interface ExerciseListRow {
  id: string;
  title: string;
  language: ExerciseLanguage;
  courseTitle: string | null;
  updatedAt: string;
  testCount: number;
  hiddenCount: number;
  submissionCount: number;
  passedCount: number;
}

export async function listExercises(filter: { search?: string; language?: string; courseId?: string } = {}): Promise<ExerciseListRow[]> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const search = filter.search?.trim().toLowerCase();
  const counts = new Map<string, { total: number; passed: number }>();
  for (const s of db.exerciseSubmissions) {
    const entry = counts.get(s.exerciseId) ?? { total: 0, passed: 0 };
    entry.total++;
    if (s.status === "passed") entry.passed++;
    counts.set(s.exerciseId, entry);
  }
  return db.exercises
    .filter((e) => {
      if (search && !e.title.toLowerCase().includes(search)) return false;
      if (filter.language && e.language !== filter.language) return false;
      if (filter.courseId && e.courseId !== filter.courseId) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((e) => ({
      id: e.id,
      title: e.title,
      language: e.language,
      courseTitle: e.courseId ? (courses.get(e.courseId)?.title ?? null) : null,
      updatedAt: e.updatedAt,
      testCount: e.testCases.length,
      hiddenCount: e.testCases.filter((t) => t.hidden).length,
      submissionCount: counts.get(e.id)?.total ?? 0,
      passedCount: counts.get(e.id)?.passed ?? 0,
    }));
}

export async function getExercise(id: string): Promise<ProgrammingExercise | null> {
  const db = await getDb();
  return db.exercises.find((e) => e.id === id) ?? null;
}

/**
 * Runner payload. Learners get hidden tests with a hash of the expected
 * output only; staff (`revealHidden`) receive everything.
 */
export function toRunnerExercise(ex: ProgrammingExercise, opts: { revealHidden: boolean }): RunnerExercise {
  return {
    id: ex.id,
    title: ex.title,
    problemStatement: ex.problemStatement,
    language: ex.language,
    starterCode: ex.starterCode || DEFAULT_STARTER_CODE[ex.language],
    courseId: ex.courseId,
    tests: ex.testCases.map((t, i) => {
      const hidden = !!t.hidden;
      if (hidden && !opts.revealHidden) {
        return { id: t.id, index: i + 1, hidden, input: t.input, expectedHash: hashOutput(t.expectedOutput) };
      }
      return { id: t.id, index: i + 1, hidden, input: t.input, expectedOutput: t.expectedOutput };
    }),
  };
}

/** Submission payload for the UI; hidden test details are stripped unless `revealHidden`. */
export function toExerciseSubmissionView(s: ExerciseSubmission, ex: ProgrammingExercise | null, opts: { revealHidden: boolean }): ExerciseSubmissionView {
  const order = new Map((ex?.testCases ?? []).map((t, i) => [t.id, { index: i + 1, hidden: !!t.hidden }]));
  const results: TestResultView[] = s.testResults.map((r, i) => {
    const meta = order.get(r.testCaseId) ?? { index: i + 1, hidden: false };
    const skipped = !r.passed && !r.actualOutput && !!r.error && r.error.startsWith("Not run");
    if (meta.hidden && !opts.revealHidden) {
      return { testCaseId: r.testCaseId, index: meta.index, hidden: true, passed: r.passed, skipped };
    }
    return {
      testCaseId: r.testCaseId,
      index: meta.index,
      hidden: meta.hidden,
      passed: r.passed,
      input: r.input,
      expectedOutput: r.expectedOutput,
      actualOutput: r.actualOutput,
      error: r.error,
      skipped,
    };
  });
  results.sort((a, b) => a.index - b.index);
  return {
    id: s.id,
    exerciseId: s.exerciseId,
    code: s.code,
    status: s.status,
    submittedAt: s.submittedAt,
    results,
    passedCount: s.testResults.filter((r) => r.passed).length,
    totalCount: s.testResults.length,
  };
}

export async function getOwnExerciseSubmission(userId: string, exerciseId: string): Promise<ExerciseSubmission | null> {
  const db = await getDb();
  return (
    db.exerciseSubmissions
      .filter((s) => s.userId === userId && s.exerciseId === exerciseId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null
  );
}

export interface ExerciseSubmissionRow {
  id: string;
  exerciseId: string;
  exerciseTitle: string;
  language: ExerciseLanguage | null;
  user: UserLite;
  status: "passed" | "failed";
  passedCount: number;
  totalCount: number;
  submittedAt: string;
}

export async function listExerciseSubmissions(filter: { exerciseId?: string; memberId?: string; status?: string } = {}): Promise<ExerciseSubmissionRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const exercises = new Map(db.exercises.map((e) => [e.id, e]));
  return db.exerciseSubmissions
    .filter((s) => {
      if (filter.exerciseId && s.exerciseId !== filter.exerciseId) return false;
      if (filter.memberId && s.userId !== filter.memberId) return false;
      if (filter.status && s.status !== filter.status) return false;
      return true;
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((s) => ({
      id: s.id,
      exerciseId: s.exerciseId,
      exerciseTitle: exercises.get(s.exerciseId)?.title ?? s.exerciseTitle,
      language: exercises.get(s.exerciseId)?.language ?? null,
      user: lite(users.get(s.userId)) ?? unknownUser(s.userId),
      status: s.status,
      passedCount: s.testResults.filter((r) => r.passed).length,
      totalCount: s.testResults.length,
      submittedAt: s.submittedAt,
    }));
}

export interface ExerciseSubmissionDetail {
  submission: ExerciseSubmission;
  exercise: ProgrammingExercise | null;
  user: UserLite;
  course: Pick<Course, "id" | "title" | "slug"> | null;
  lessonHref: string | null;
  lessonTitle: string | null;
}

export async function getExerciseSubmissionDetail(id: string): Promise<ExerciseSubmissionDetail | null> {
  const db = await getDb();
  const submission = db.exerciseSubmissions.find((s) => s.id === id);
  if (!submission) return null;
  const exercise = db.exercises.find((e) => e.id === submission.exerciseId) ?? null;
  const user = db.users.find((u) => u.id === submission.userId);
  const courseId = submission.courseId ?? exercise?.courseId;
  const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
  const lesson = submission.lessonId ? db.lessons.find((l) => l.id === submission.lessonId) : undefined;
  return {
    submission,
    exercise,
    user: lite(user ? toPublicUser(user) : null) ?? unknownUser(submission.userId),
    course: course ? { id: course.id, title: course.title, slug: course.slug } : null,
    lessonHref: lesson ? await getLessonHref(lesson.id) : null,
    lessonTitle: lesson?.title ?? null,
  };
}
