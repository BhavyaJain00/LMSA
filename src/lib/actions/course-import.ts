import "server-only";
import { revalidatePath } from "next/cache";
import type {
  Assignment,
  AssignmentType,
  CardGradient,
  Chapter,
  Course,
  ExerciseLanguage,
  Lesson,
  ProgrammingExercise,
  Question,
  QuestionType,
  Quiz,
} from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { RESERVED_COURSE_SLUGS, canCreateCourses, canEvaluateCertificates } from "@/lib/data/admin-courses";
import { computeLessonDuration, isBlockedVideoHost, sanitizeBlocks } from "@/components/admin/courses/blocks";
import { cardGradients, currencies } from "@/lib/config";
import { isValidUrl, slugify, uid, unique, uniqueSlug } from "@/lib/utils";
import { MAX_PREREQUISITES, cleanReleaseRule } from "@/components/learn/drip-shared";

/**
 * Largest accepted export file. The upload goes through a route handler (not a
 * Server Action, which is capped at 1 MB), and must stay below the 10 MB body
 * buffer that src/proxy.ts applies to /admin routes.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ImportCourseResult =
  | { ok: true; courseId: string; redirectTo: string; message: string; tone: "success" | "warning" }
  | { ok: false; error: string; status: number };

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 100_000): string => (typeof v === "string" ? v.slice(0, max) : "");
const optText = (v: unknown, max = 2000): string | undefined => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || undefined;
};
const bool = (v: unknown): boolean => v === true;
const nonNeg = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const strList = (v: unknown, max = 50, maxLen = 200): string[] =>
  Array.isArray(v) ? unique(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean)).slice(0, max) : [];
const optUrl = (v: unknown): string | undefined => {
  const s = optText(v);
  return s && isValidUrl(s) ? s : undefined;
};
/** Drip release rule of an imported chapter/lesson (invalid values are dropped). */
const releaseRuleOf = (r: Raw) => cleanReleaseRule({ dripDays: typeof r.dripDays === "number" ? r.dripDays : undefined, availableFrom: typeof r.availableFrom === "string" ? r.availableFrom : undefined });

const QUESTION_TYPES: QuestionType[] = ["choices", "user_input", "open_ended"];
const ASSIGNMENT_TYPES: AssignmentType[] = ["document", "pdf", "url", "image", "text"];
const LANGUAGES: ExerciseLanguage[] = ["javascript", "typescript", "python", "go", "rust"];

const fail = (error: string, status = 400): ImportCourseResult => ({ ok: false, error, status });

/**
 * Import a course from a JSON export (see /admin/courses/[id]/export).
 * All ids are regenerated, references are remapped, and the new course is
 * created unpublished and "in progress" so it goes through review again.
 * Called by the POST /admin/courses/import/upload route handler.
 */
export async function importCourseFile(file: FormDataEntryValue | null): Promise<ImportCourseResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Your session has expired. Please log in again.", 401);
  if (!canCreateCourses(user)) return fail("Your role can't create courses.", 403);

  if (!(file instanceof File) || file.size === 0) return fail("Please choose a course JSON file.");
  if (file.size > MAX_IMPORT_BYTES) return fail("This file is too large (max 5 MB).", 413);
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") return fail("Please upload a valid JSON export.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return fail("Error importing course: the file is not valid JSON.");
  }
  if (!isObj(parsed) || parsed.format !== "learnloop-course") return fail("Error importing course: this is not a course export file.");
  if (parsed.version !== 1) return fail(`Error importing course: unsupported export version ${String(parsed.version)}.`);
  if (!isObj(parsed.course)) return fail("Error importing course: the course details are missing.");
  for (const key of ["chapters", "lessons", "quizzes", "questions", "assignments", "exercises"] as const) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) return fail(`Error importing course: "${key}" must be a list.`);
  }
  const rawCourse = parsed.course;
  const title = text(rawCourse.title, 140).trim().replace(/\s+/g, " ");
  if (!title) return fail("Error importing course: the course has no title.");

  const list = (key: string): Raw[] => (Array.isArray(parsed[key]) ? (parsed[key] as unknown[]).filter(isObj) : []);
  const rawChapters = list("chapters");
  const rawLessons = list("lessons");
  if (rawChapters.length > 200 || rawLessons.length > 2000) return fail("Error importing course: the outline is too large.");

  const db = await getDb();
  const now = new Date().toISOString();
  const courseId = uid("crs");
  const oldCourseId = text(rawCourse.id, 100);
  const warnings: string[] = [];

  /* ------------------------------ Question bank ----------------------------- */
  const questionMap = new Map<string, string>();
  const questions: Question[] = [];
  for (const q of list("questions")) {
    const oldId = text(q.id, 100);
    const qText = text(q.text).trim();
    const type = QUESTION_TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : null;
    if (!oldId || !qText || !type) continue;
    const id = uid("qst");
    questionMap.set(oldId, id);
    questions.push({
      id,
      text: qText,
      type,
      multiple: bool(q.multiple),
      marks: Math.max(1, Math.round(nonNeg(q.marks, 1))),
      options: (Array.isArray(q.options) ? q.options.filter(isObj) : [])
        .map((o) => ({ id: uid("opt"), text: text(o.text, 2000).trim(), isCorrect: bool(o.isCorrect), explanation: optText(o.explanation) }))
        .filter((o) => o.text),
      possibilities: strList(q.possibilities),
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  /* --------------------------------- Quizzes -------------------------------- */
  const quizMap = new Map<string, string>();
  const quizzes: Quiz[] = [];
  const rawQuizLessons = new Map<string, string>();
  for (const q of list("quizzes")) {
    const oldId = text(q.id, 100);
    const quizTitle = text(q.title, 200).trim();
    if (!oldId || !quizTitle) continue;
    const id = uid("quiz");
    quizMap.set(oldId, id);
    const refs = (Array.isArray(q.questions) ? q.questions.filter(isObj) : [])
      .map((r) => ({ questionId: questionMap.get(text(r.questionId, 100)) ?? "", marks: Math.max(1, Math.round(nonNeg(r.marks, 1))) }))
      .filter((r) => r.questionId);
    const lessonRef = text(q.lessonId, 100);
    if (lessonRef) rawQuizLessons.set(id, lessonRef);
    quizzes.push({
      id,
      title: quizTitle,
      courseId,
      questions: refs,
      maxAttempts: Math.round(nonNeg(q.maxAttempts)),
      showAnswers: q.showAnswers === undefined ? true : bool(q.showAnswers),
      showSubmissionHistory: bool(q.showSubmissionHistory),
      passingPercentage: Math.min(100, Math.round(nonNeg(q.passingPercentage, 70))),
      totalMarks: refs.reduce((s, r) => s + r.marks, 0),
      shuffleQuestions: bool(q.shuffleQuestions),
      limitQuestionsTo: Math.round(nonNeg(q.limitQuestionsTo)),
      durationSeconds: Math.round(nonNeg(q.durationSeconds)),
      enableNegativeMarking: bool(q.enableNegativeMarking),
      marksToCut: nonNeg(q.marksToCut),
      enableScheduling: false,
      enableProctoring: bool(q.enableProctoring),
      maxViolations: Math.round(nonNeg(q.maxViolations, 3)),
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  /* ------------------------------- Assignments ------------------------------ */
  const assignmentMap = new Map<string, string>();
  const assignments: Assignment[] = [];
  for (const a of list("assignments")) {
    const oldId = text(a.id, 100);
    const aTitle = text(a.title, 200).trim();
    if (!oldId || !aTitle) continue;
    const id = uid("asg");
    assignmentMap.set(oldId, id);
    assignments.push({
      id,
      title: aTitle,
      question: text(a.question),
      type: ASSIGNMENT_TYPES.includes(a.type as AssignmentType) ? (a.type as AssignmentType) : "text",
      showAnswer: bool(a.showAnswer),
      answer: optText(a.answer, 50_000),
      gradeAssignment: a.gradeAssignment === undefined ? true : bool(a.gradeAssignment),
      courseId,
      enableScheduling: false,
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  /* -------------------------------- Exercises ------------------------------- */
  const exerciseMap = new Map<string, string>();
  const exercises: ProgrammingExercise[] = [];
  for (const e of list("exercises")) {
    const oldId = text(e.id, 100);
    const eTitle = text(e.title, 200).trim();
    if (!oldId || !eTitle) continue;
    const id = uid("ex");
    exerciseMap.set(oldId, id);
    exercises.push({
      id,
      title: eTitle,
      problemStatement: text(e.problemStatement),
      language: LANGUAGES.includes(e.language as ExerciseLanguage) ? (e.language as ExerciseLanguage) : "javascript",
      starterCode: optText(e.starterCode, 50_000),
      testCases: (Array.isArray(e.testCases) ? e.testCases.filter(isObj) : []).map((t) => ({
        id: uid("tc"),
        input: text(t.input, 20_000),
        expectedOutput: text(t.expectedOutput, 20_000),
        hidden: bool(t.hidden) || undefined,
      })),
      courseId,
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  /* ------------------------------ Chapters ---------------------------------- */
  const chapterMap = new Map<string, string>();
  const chapters: Chapter[] = [...rawChapters]
    .sort((a, b) => nonNeg(a.order) - nonNeg(b.order))
    .map((c, i) => {
      const id = uid("chp");
      chapterMap.set(text(c.id, 100), id);
      return {
        id,
        courseId,
        title: text(c.title, 120).trim() || `Chapter ${i + 1}`,
        description: optText(c.description, 1000),
        order: i + 1,
        ...releaseRuleOf(c),
      };
    });

  /* ------------------------------- Lessons ---------------------------------- */
  const validation = {
    quizIds: new Set([...db.quizzes.map((q) => q.id), ...quizzes.map((q) => q.id)]),
    assignmentIds: new Set([...db.assignments.map((a) => a.id), ...assignments.map((a) => a.id)]),
    exerciseIds: new Set([...db.exercises.map((e) => e.id), ...exercises.map((e) => e.id)]),
    regenerateIds: true,
    remap: { quizzes: quizMap, assignments: assignmentMap, exercises: exerciseMap },
  };
  const lessonMap = new Map<string, string>();
  const lessons: Lesson[] = [];
  const takenLessonSlugs: string[] = [];
  let skippedBlocks = 0;
  let unreadableLessons = 0;
  let orphanLessons = 0;
  const byChapter = new Map<string, Raw[]>();
  for (const l of rawLessons) {
    const chapterId = chapterMap.get(text(l.chapterId, 100));
    if (!chapterId) {
      orphanLessons++;
      continue;
    }
    byChapter.set(chapterId, [...(byChapter.get(chapterId) ?? []), l]);
  }
  for (const chapter of chapters) {
    const rows = (byChapter.get(chapter.id) ?? []).sort((a, b) => nonNeg(a.order) - nonNeg(b.order));
    rows.forEach((l, i) => {
      const id = uid("les");
      lessonMap.set(text(l.id, 100), id);
      const lessonTitle = text(l.title, 160).trim() || "Untitled lesson";
      const { blocks, errors } = sanitizeBlocks(l.blocks ?? [], validation);
      // "_" means the whole block list was rejected (not a list, or too many blocks): the lesson is imported empty.
      if (errors._) unreadableLessons++;
      const kept = blocks.filter((b) => !errors[b.id]);
      skippedBlocks += blocks.length - kept.length;
      const rawSlug = text(l.slug, 80).toLowerCase();
      const slug = uniqueSlug(rawSlug && /^[a-z0-9-]+$/.test(rawSlug) ? rawSlug : lessonTitle, takenLessonSlugs);
      takenLessonSlugs.push(slug);
      lessons.push({
        id,
        courseId,
        chapterId: chapter.id,
        slug,
        title: lessonTitle,
        order: i + 1,
        blocks: kept,
        instructorNotes: optText(l.instructorNotes, 50_000),
        includeInPreview: bool(l.includeInPreview),
        durationSeconds: computeLessonDuration(kept),
        ...releaseRuleOf(l),
        createdAt: now,
        updatedAt: now,
      });
    });
  }
  for (const quiz of quizzes) {
    const lessonId = lessonMap.get(rawQuizLessons.get(quiz.id) ?? "");
    if (lessonId) quiz.lessonId = lessonId;
  }
  if (skippedBlocks) warnings.push(`${skippedBlocks} invalid ${skippedBlocks === 1 ? "block was" : "blocks were"} skipped`);
  if (unreadableLessons) {
    warnings.push(`${unreadableLessons} ${unreadableLessons === 1 ? "lesson had" : "lessons had"} unreadable content and ${unreadableLessons === 1 ? "was" : "were"} imported empty`);
  }
  if (orphanLessons) warnings.push(`${orphanLessons} ${orphanLessons === 1 ? "lesson without a chapter was" : "lessons without a chapter were"} skipped`);

  /* -------------------------------- Course ---------------------------------- */
  const instructorPool = new Set(db.users.filter((u) => u.enabled && u.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin")).map((u) => u.id));
  let instructorIds = strList(rawCourse.instructorIds).filter((id) => instructorPool.has(id));
  if (!instructorIds.length) instructorIds = [user.id];
  const rawEvaluatorId = optText(rawCourse.evaluatorId, 100);
  const evaluatorId = rawEvaluatorId && canEvaluateCertificates(db.users.find((u) => u.id === rawEvaluatorId && u.enabled)) ? rawEvaluatorId : undefined;
  // A paid certificate needs an evaluator (same rule as the Settings tab).
  const paidCertificate = bool(rawCourse.paidCertificate) && !bool(rawCourse.paidCourse) && !!evaluatorId;
  if (bool(rawCourse.paidCertificate) && !bool(rawCourse.paidCourse) && !evaluatorId) warnings.push("paid certificate was turned off because the evaluator is not available here");
  const categoryId = optText(rawCourse.categoryId, 100);
  const gradient = text(rawCourse.cardGradient, 20);
  const currency = text(rawCourse.currency, 5).toUpperCase();
  const videoUrl = optUrl(rawCourse.videoUrl);
  const takenCourseSlugs = [...db.courses.map((c) => c.slug), ...RESERVED_COURSE_SLUGS];
  const slugBase = text(rawCourse.slug, 80) || slugify(title);
  const prerequisiteCourseIds = strList(rawCourse.prerequisiteCourseIds)
    .filter((id) => id !== oldCourseId && db.courses.some((c) => c.id === id))
    .slice(0, MAX_PREREQUISITES);

  const course: Course = {
    id: courseId,
    slug: uniqueSlug(slugBase, takenCourseSlugs),
    title,
    shortIntroduction: text(rawCourse.shortIntroduction, 300).trim() || title,
    description: text(rawCourse.description, 50_000).trim() || text(rawCourse.shortIntroduction, 300).trim() || title,
    imageUrl: optUrl(rawCourse.imageUrl),
    videoUrl: videoUrl && !isBlockedVideoHost(videoUrl) ? videoUrl : undefined,
    cardGradient: (cardGradients as readonly string[]).includes(gradient) ? (gradient as CardGradient) : "blue",
    instructorIds,
    evaluatorId,
    categoryId: categoryId && db.categories.some((c) => c.id === categoryId) ? categoryId : undefined,
    tags: strList(rawCourse.tags, 12, 32),
    price: Math.round(nonNeg(rawCourse.price)),
    currency: (currencies as readonly string[]).includes(currency) ? currency : db.settings.commerce.defaultCurrency || "USD",
    paidCourse: bool(rawCourse.paidCourse),
    paidCertificate,
    certificatePrice: Math.round(nonNeg(rawCourse.certificatePrice)),
    enableCertification: bool(rawCourse.enableCertification) && !paidCertificate,
    published: false,
    upcoming: bool(rawCourse.upcoming),
    featured: false,
    disableSelfLearning: bool(rawCourse.disableSelfLearning),
    enforceLessonCompletion: bool(rawCourse.enforceLessonCompletion),
    status: "in_progress",
    relatedCourseIds: strList(rawCourse.relatedCourseIds).filter((id) => id !== oldCourseId && db.courses.some((c) => c.id === id)),
    // Prerequisites only survive when those courses exist here (the new course can't be part of a cycle yet).
    ...(prerequisiteCourseIds.length ? { prerequisiteCourseIds } : {}),
    outcomes: strList(rawCourse.outcomes, 20),
    requirements: strList(rawCourse.requirements, 20),
    metaDescription: optText(rawCourse.metaDescription, 160)?.replace(/\s+/g, " "),
    metaKeywords: optText(rawCourse.metaKeywords, 500),
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.questions.push(...questions);
    d.quizzes.push(...quizzes);
    d.assignments.push(...assignments);
    d.exercises.push(...exercises);
    d.courses.push(course);
    d.chapters.push(...chapters);
    d.lessons.push(...lessons);
  });
  await audit(user, "course.import", { type: "course", id: course.id }, {
    title: course.title,
    slug: course.slug,
    file: file.name,
    bytes: file.size,
    chapters: chapters.length,
    lessons: lessons.length,
    quizzes: quizzes.length,
    questions: questions.length,
    assignments: assignments.length,
    exercises: exercises.length,
    warnings: warnings.length,
  });

  revalidatePath("/admin/courses");
  revalidatePath("/admin/quizzes");
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/exercises");
  return {
    ok: true,
    courseId: course.id,
    redirectTo: `/admin/courses/${course.id}?tab=outline`,
    message: warnings.length ? `Course imported successfully! (${warnings.join("; ")})` : "Course imported successfully!",
    tone: warnings.length ? "warning" : "success",
  };
}
