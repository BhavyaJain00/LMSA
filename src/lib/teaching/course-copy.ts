import type {
  Assignment,
  Chapter,
  Course,
  CourseSalesPage,
  Lesson,
  LessonBlock,
  PeerReviewSettings,
  ProgrammingExercise,
  Question,
  Quiz,
  Transcript,
} from "@/lib/types";
import { uid, uniqueSlug } from "@/lib/utils";

/**
 * Deep copy of a course ("Duplicate course"). Pure: the caller collects the
 * course and everything its lessons use, and writes the result to the store.
 *
 * Copied with new ids: the course (details, settings, sales page), its
 * chapters, lessons and blocks, and every quiz, question, assignment and
 * exercise used by a lesson block, an in-video quiz marker or linked to the
 * course, plus the transcripts of lesson videos. Every reference between them
 * is remapped, so the copy shares nothing with the original and both can be
 * edited (or deleted) independently.
 *
 * Not copied: enrollments, progress, submissions, reviews, discussions,
 * announcements, certificates, payments and lesson history.
 */

export interface CourseGraph {
  course: Course;
  chapters: Chapter[];
  lessons: Lesson[];
  quizzes: Quiz[];
  questions: Question[];
  assignments: Assignment[];
  exercises: ProgrammingExercise[];
  transcripts: Transcript[];
}

export type CopiedKind = "chapters" | "lessons" | "blocks" | "quizzes" | "questions" | "assignments" | "exercises" | "transcripts";

export interface CourseCopy extends CourseGraph {
  /** Old id → new id, per kind. */
  idMap: Record<CopiedKind, Map<string, string>>;
  sourceId: string;
}

export interface CopyOptions {
  /** Who makes the copy: becomes its creator and the author of the copied assessments. */
  actorId: string;
  /** ISO time stamped on everything created. */
  now: string;
  /** Title of the copy; defaults to "Copy of <title>". */
  title?: string;
  /** Course slugs already in use (and reserved words). */
  takenSlugs: Iterable<string>;
  /** Id generator, replaceable in tests. */
  newId?: (prefix: string) => string;
}

export const COURSE_TITLE_MAX = 140;
const COPY_PREFIX = "Copy of ";

/** "Copy of <title>", cut to the course title limit. */
export function copyTitle(title: string): string {
  const full = `${COPY_PREFIX}${title.trim()}`;
  return full.length > COURSE_TITLE_MAX ? `${full.slice(0, COURSE_TITLE_MAX - 1).trimEnd()}…` : full;
}

/**
 * A copy title nobody uses yet: "Copy of X", then "Copy of X (2)", "(3)"…
 * Titles are compared without regard to case.
 */
export function uniqueCopyTitle(title: string, takenTitles: Iterable<string>): string {
  const taken = new Set(Array.from(takenTitles, (t) => t.trim().toLowerCase()));
  const base = copyTitle(title);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.length + suffix.length > COURSE_TITLE_MAX ? `${base.slice(0, COURSE_TITLE_MAX - suffix.length - 1).trimEnd()}…` : base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** What a copy contains, for the confirmation dialog and the audit entry. */
export interface CopyCounts {
  chapters: number;
  lessons: number;
  blocks: number;
  quizzes: number;
  questions: number;
  assignments: number;
  exercises: number;
  transcripts: number;
}

export function countGraph(graph: CourseGraph): CopyCounts {
  const chapterIds = new Set(graph.chapters.map((c) => c.id));
  const lessons = graph.lessons.filter((l) => chapterIds.has(l.chapterId));
  const lessonIds = new Set(lessons.map((l) => l.id));
  const blockIds = new Set(lessons.flatMap((l) => l.blocks.map((b) => b.id)));
  const questionIds = new Set(graph.quizzes.flatMap((q) => q.questions.map((ref) => ref.questionId)));
  return {
    chapters: graph.chapters.length,
    lessons: lessons.length,
    blocks: blockIds.size,
    quizzes: graph.quizzes.length,
    questions: graph.questions.filter((q) => questionIds.has(q.id)).length,
    assignments: graph.assignments.length,
    exercises: graph.exercises.length,
    transcripts: graph.transcripts.filter((t) => t.status === "ready" && lessonIds.has(t.lessonId) && blockIds.has(t.blockId)).length,
  };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Peer review settings without the reviewer/submission pairs an instructor excluded (they name submissions of the original). */
function copyPeerReview(settings: PeerReviewSettings | undefined): PeerReviewSettings | undefined {
  if (!settings) return undefined;
  const copy = clone(settings) as PeerReviewSettings & { excluded?: unknown };
  delete copy.excluded;
  return copy;
}

function copySalesPage(page: CourseSalesPage | undefined): CourseSalesPage | undefined {
  if (!page) return undefined;
  const copy = clone(page);
  // A countdown that already ended would show an expired offer on the copy.
  delete copy.countdownEndsAt;
  return copy;
}

export function copyCourseGraph(source: CourseGraph, opts: CopyOptions): CourseCopy {
  const newId = opts.newId ?? uid;
  const { now, actorId } = opts;
  const idMap: CourseCopy["idMap"] = {
    chapters: new Map(),
    lessons: new Map(),
    blocks: new Map(),
    quizzes: new Map(),
    questions: new Map(),
    assignments: new Map(),
    exercises: new Map(),
    transcripts: new Map(),
  };
  const courseId = newId("crs");

  // Ids first, so references can point forward (a quiz at its lesson, a block at its quiz).
  for (const chapter of source.chapters) idMap.chapters.set(chapter.id, newId("chp"));
  for (const lesson of source.lessons) {
    if (!idMap.chapters.has(lesson.chapterId)) continue;
    idMap.lessons.set(lesson.id, newId("les"));
    for (const block of lesson.blocks) idMap.blocks.set(block.id, newId("blk"));
  }
  for (const quiz of source.quizzes) idMap.quizzes.set(quiz.id, newId("quiz"));
  const usedQuestionIds = new Set(source.quizzes.flatMap((quiz) => quiz.questions.map((ref) => ref.questionId)));
  for (const question of source.questions) if (usedQuestionIds.has(question.id)) idMap.questions.set(question.id, newId("qst"));
  for (const assignment of source.assignments) idMap.assignments.set(assignment.id, newId("asg"));
  for (const exercise of source.exercises) idMap.exercises.set(exercise.id, newId("ex"));
  const sourceBlockIds = new Set(idMap.blocks.keys());
  for (const transcript of source.transcripts) {
    if (transcript.status === "ready" && idMap.lessons.has(transcript.lessonId) && sourceBlockIds.has(transcript.blockId)) {
      idMap.transcripts.set(transcript.id, newId("trn"));
    }
  }

  const questions: Question[] = source.questions
    .filter((question) => idMap.questions.has(question.id))
    .map((question) => ({
      ...clone(question),
      id: idMap.questions.get(question.id)!,
      options: question.options.map((option) => ({ ...clone(option), id: newId("opt") })),
      authorId: actorId,
      createdAt: now,
      updatedAt: now,
    }));

  const quizzes: Quiz[] = source.quizzes.map((quiz) => {
    const copy: Quiz = {
      ...clone(quiz),
      id: idMap.quizzes.get(quiz.id)!,
      courseId,
      // Questions that no longer exist are left out, exactly as the quiz player skips them.
      questions: quiz.questions.filter((ref) => idMap.questions.has(ref.questionId)).map((ref) => ({ questionId: idMap.questions.get(ref.questionId)!, marks: ref.marks })),
      // Availability windows belong to the original run of the course.
      enableScheduling: false,
      authorId: actorId,
      createdAt: now,
      updatedAt: now,
    };
    delete copy.scheduleStart;
    delete copy.scheduleEnd;
    const lessonId = quiz.lessonId ? idMap.lessons.get(quiz.lessonId) : undefined;
    if (lessonId) copy.lessonId = lessonId;
    else delete copy.lessonId;
    return copy;
  });

  const assignments: Assignment[] = source.assignments.map((assignment) => {
    const copy: Assignment = { ...clone(assignment), id: idMap.assignments.get(assignment.id)!, courseId, enableScheduling: false, authorId: actorId, createdAt: now, updatedAt: now };
    delete copy.scheduleStart;
    delete copy.scheduleEnd;
    const peerReview = copyPeerReview(assignment.peerReview);
    if (peerReview) copy.peerReview = peerReview;
    else delete copy.peerReview;
    return copy;
  });

  const exercises: ProgrammingExercise[] = source.exercises.map((exercise) => ({
    ...clone(exercise),
    id: idMap.exercises.get(exercise.id)!,
    courseId,
    testCases: exercise.testCases.map((test) => ({ ...clone(test), id: newId("tc") })),
    authorId: actorId,
    createdAt: now,
    updatedAt: now,
  }));

  const chapters: Chapter[] = source.chapters.map((chapter) => ({ ...clone(chapter), id: idMap.chapters.get(chapter.id)!, courseId }));

  const copyBlock = (block: LessonBlock): LessonBlock => {
    const copy = clone(block);
    copy.id = idMap.blocks.get(block.id)!;
    if (copy.type === "quiz") copy.quizId = idMap.quizzes.get(copy.quizId) ?? copy.quizId;
    else if (copy.type === "assignment") copy.assignmentId = idMap.assignments.get(copy.assignmentId) ?? copy.assignmentId;
    else if (copy.type === "exercise") copy.exerciseId = idMap.exercises.get(copy.exerciseId) ?? copy.exerciseId;
    else if (copy.type === "video") {
      if (copy.quizMarkers) copy.quizMarkers = copy.quizMarkers.map((marker) => ({ ...marker, quizId: idMap.quizzes.get(marker.quizId) ?? marker.quizId }));
      // The converted streams are stored per lesson and block and are deleted with the original's
      // video. The copy plays the uploaded file, which both can share, until it is converted itself.
      delete copy.hlsUrl;
      delete copy.transcode;
      const transcriptId = copy.transcriptId ? idMap.transcripts.get(copy.transcriptId) : undefined;
      if (transcriptId) copy.transcriptId = transcriptId;
      else delete copy.transcriptId;
    }
    return copy;
  };

  const lessons: Lesson[] = source.lessons
    .filter((lesson) => idMap.lessons.has(lesson.id))
    .map((lesson) => {
      const copy: Lesson = {
        ...clone(lesson),
        id: idMap.lessons.get(lesson.id)!,
        courseId,
        chapterId: idMap.chapters.get(lesson.chapterId)!,
        blocks: lesson.blocks.map(copyBlock),
        createdAt: now,
        updatedAt: now,
      };
      // A publish time is a one-off decision about the original lesson.
      delete copy.publishAt;
      return copy;
    });

  const transcripts: Transcript[] = source.transcripts
    .filter((transcript) => idMap.transcripts.has(transcript.id))
    .map((transcript) => ({
      ...clone(transcript),
      id: idMap.transcripts.get(transcript.id)!,
      lessonId: idMap.lessons.get(transcript.lessonId)!,
      blockId: idMap.blocks.get(transcript.blockId)!,
      createdAt: now,
      updatedAt: now,
    }));

  const original = source.course;
  const title = (opts.title?.replace(/\s+/g, " ").trim() || copyTitle(original.title)).slice(0, COURSE_TITLE_MAX);
  const course: Course = {
    ...clone(original),
    id: courseId,
    slug: uniqueSlug(`${original.slug}-copy`, opts.takenSlugs),
    title,
    published: false,
    featured: false,
    // The copy goes through review like any new course.
    status: "in_progress",
    createdById: actorId,
    createdAt: now,
    updatedAt: now,
  };
  delete course.publishedOn;
  delete course.publishAt;
  const salesPage = copySalesPage(original.salesPage);
  if (salesPage) course.salesPage = salesPage;

  return { sourceId: original.id, course, chapters, lessons, quizzes, questions, assignments, exercises, transcripts, idMap };
}
