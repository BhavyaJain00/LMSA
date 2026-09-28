import "server-only";
import type {
  Certificate,
  ChapterWithLessons,
  Course,
  Database,
  Enrollment,
  Lesson,
  LessonWithState,
  PublicUser,
  Settings,
  User,
} from "@/lib/types";
import type {
  LessonKind,
  LessonNeighbor,
  LockReason,
  NoteItem,
  OutlineChapterItem,
  OutlineLessonItem,
  ReplyItem,
  TopicItem,
  UserChip,
} from "@/components/learn/types";
import { getDb } from "@/lib/db/store";
import { toPublicUser } from "@/lib/auth/session";
import { canManageCourse, findLessonByNumbers, getCourseBySlug, getCourseOutline, getEnrollment, lessonHref, parseLessonRef } from "./courses";
import { getPublicUsers } from "./users";
import { percent } from "@/lib/utils";

/**
 * Data access for the lesson player (/courses/[slug]/learn/[ref]).
 *
 * Access rules (mirrors Frappe LMS get_lesson):
 *  - Course managers (instructors, moderators, admins) can open every lesson.
 *  - Enrolled learners can open every lesson, except that with
 *    `enforceLessonCompletion` every lesson after the first incomplete one is
 *    locked (lessons that are already complete never lock).
 *  - Everyone else can open only "include in preview" lessons, and only when
 *    the course is published and guest access is enabled in settings.
 */

/* ------------------------------------------------------------------ */
/* Outline with viewer-specific locking                                 */
/* ------------------------------------------------------------------ */

export interface LearnLesson extends LessonWithState {
  lockReason?: LockReason;
  href: string;
  kind: LessonKind;
}

export interface LearnChapter extends Omit<ChapterWithLessons, "lessons"> {
  number: number;
  lessons: LearnLesson[];
}

export interface LearnContext {
  course: Course;
  viewer: User | null;
  settings: Settings;
  enrollment: Enrollment | null;
  /** Instructor of the course, moderator or admin. */
  manager: boolean;
  enrolled: boolean;
  /** Preview lessons are open to non-enrolled viewers. */
  previewAllowed: boolean;
  chapters: LearnChapter[];
  flat: LearnLesson[];
  progress: { completed: number; total: number; percent: number };
}

/** The kind of a lesson for icons: the first video/quiz/assignment/exercise block wins. */
export function lessonKind(lesson: Pick<Lesson, "blocks">): LessonKind {
  for (const block of lesson.blocks) {
    if (block.type === "video") return "video";
    if (block.type === "quiz") return "quiz";
    if (block.type === "assignment") return "assignment";
    if (block.type === "exercise") return "exercise";
  }
  return "text";
}

/** Build the outline for a viewer with the Frappe locking semantics applied. */
export async function getLearnContext(course: Course, viewer: User | null): Promise<LearnContext> {
  const [raw, db, enrollment] = await Promise.all([
    getCourseOutline(course, viewer),
    getDb(),
    viewer ? getEnrollment(viewer.id, course.id) : Promise.resolve(null),
  ]);
  const settings = db.settings;
  const manager = canManageCourse(viewer, course);
  const enrolled = !!enrollment;
  const previewAllowed = course.published && settings.learning.allowGuestAccess;

  const rawFlat = raw.flatMap((c) => c.lessons);
  const firstIncomplete = rawFlat.findIndex((l) => l.status !== "complete");

  let index = 0;
  const chapters: LearnChapter[] = raw.map((chapter, ci) => ({
    ...chapter,
    number: ci + 1,
    lessons: chapter.lessons.map((lesson) => {
      const position = index++;
      let locked = false;
      let lockReason: LockReason | undefined;
      if (!manager) {
        if (!enrolled) {
          locked = !(previewAllowed && lesson.includeInPreview);
          if (locked) lockReason = "enroll";
        } else if (course.enforceLessonCompletion && firstIncomplete !== -1 && position > firstIncomplete && lesson.status !== "complete") {
          locked = true;
          lockReason = "sequential";
        }
      }
      return {
        ...lesson,
        locked,
        lockReason,
        href: lessonHref(course.slug, lesson),
        kind: lessonKind(lesson),
      };
    }),
  }));

  const flat = chapters.flatMap((c) => c.lessons);
  const completed = flat.filter((l) => l.status === "complete").length;
  return {
    course,
    viewer,
    settings,
    enrollment,
    manager,
    enrolled,
    previewAllowed,
    chapters,
    flat,
    progress: { completed, total: flat.length, percent: percent(completed, flat.length) },
  };
}

/** Client-safe outline (no lesson content or instructor notes). */
export function toOutlineItems(chapters: LearnChapter[]): OutlineChapterItem[] {
  return chapters.map((chapter) => ({
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    lessons: chapter.lessons.map(toOutlineLesson),
  }));
}

function toOutlineLesson(lesson: LearnLesson): OutlineLessonItem {
  return {
    id: lesson.id,
    title: lesson.title,
    href: lesson.href,
    chapterNumber: lesson.chapterNumber,
    lessonNumber: lesson.lessonNumber,
    status: lesson.status,
    locked: lesson.locked,
    lockReason: lesson.lockReason,
    durationSeconds: lesson.durationSeconds,
    kind: lesson.kind,
    preview: lesson.includeInPreview,
  };
}

export function toNeighbor(lesson: LearnLesson | null | undefined): LessonNeighbor | null {
  if (!lesson) return null;
  return {
    id: lesson.id,
    title: lesson.title,
    href: lesson.href,
    status: lesson.status,
    locked: lesson.locked,
    lockReason: lesson.lockReason,
    chapterNumber: lesson.chapterNumber,
    lessonNumber: lesson.lessonNumber,
  };
}

/**
 * Where "continue learning" should take the viewer: the lesson they last
 * opened (when it is still unlocked and not complete), else the first
 * unlocked incomplete lesson, else the first unlocked lesson.
 */
export function pickResumeLesson(ctx: Pick<LearnContext, "flat" | "enrollment">): LearnLesson | null {
  const { flat, enrollment } = ctx;
  if (!flat.length) return null;
  if (enrollment?.currentLessonId) {
    const current = flat.find((l) => l.id === enrollment.currentLessonId);
    if (current && !current.locked && current.status !== "complete") return current;
  }
  return flat.find((l) => !l.locked && l.status !== "complete") ?? flat.find((l) => !l.locked) ?? flat[0] ?? null;
}

export async function getResumeLessonForCourse(course: Course, viewer: User | null): Promise<LearnLesson | null> {
  const ctx = await getLearnContext(course, viewer);
  return pickResumeLesson(ctx);
}

/* ------------------------------------------------------------------ */
/* Access checks (used by server actions and route handlers)            */
/* ------------------------------------------------------------------ */

export interface LessonAccess {
  lesson: Lesson;
  course: Course;
  settings: Settings;
  enrollment: Enrollment | null;
  manager: boolean;
  enrolled: boolean;
  /** The viewer may open the lesson page. */
  canView: boolean;
  locked: boolean;
  lockReason?: LockReason;
  status: LearnLesson["status"];
  href: string;
}

/** Resolve everything needed to authorize an action on a lesson. */
export async function getLessonAccess(user: User | null, lessonId: string): Promise<LessonAccess | null> {
  if (!lessonId) return null;
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return null;
  const ctx = await getLearnContext(course, user);
  const item = ctx.flat.find((l) => l.id === lesson.id);
  if (!item) return null;
  const courseVisible = course.published || ctx.manager || ctx.enrolled;
  return {
    lesson,
    course,
    settings: ctx.settings,
    enrollment: ctx.enrollment,
    manager: ctx.manager,
    enrolled: ctx.enrolled,
    canView: courseVisible && !item.locked,
    locked: item.locked,
    lockReason: item.lockReason,
    status: item.status,
    href: item.href,
  };
}

/* ------------------------------------------------------------------ */
/* Lesson page                                                          */
/* ------------------------------------------------------------------ */

export interface VideoWatchInfo {
  lastPositionSeconds: number;
  maxPositionSeconds: number;
  completed: boolean;
}

interface LessonPageBase {
  ctx: LearnContext;
}

export interface LessonPageOk extends LessonPageBase {
  kind: "ok";
  lesson: LearnLesson;
  chapter: { id: string; number: number; title: string };
  index: number;
  total: number;
  prev: LearnLesson | null;
  next: LearnLesson | null;
  instructors: PublicUser[];
  certificate: Certificate | null;
  watches: Record<string, VideoWatchInfo>;
  passedQuizIds: string[];
  quizTitles: Record<string, string>;
}

export type LessonPageData =
  | { kind: "not_found" }
  | { kind: "redirect"; href: string }
  | (LessonPageBase & { kind: "missing"; resume: LearnLesson | null })
  | (LessonPageBase & { kind: "locked"; lesson: LearnLesson; resume: LearnLesson | null })
  | (LessonPageBase & { kind: "no_preview"; lesson: LearnLesson })
  | LessonPageOk;

/** Load and authorize a lesson by course slug and `<chapter>-<lesson>` ref. */
export async function getLessonPageData(slug: string, ref: string, viewer: User | null): Promise<LessonPageData> {
  const course = await getCourseBySlug(slug);
  if (!course) return { kind: "not_found" };
  const ctx = await getLearnContext(course, viewer);
  if (!course.published && !ctx.manager && !ctx.enrolled) return { kind: "not_found" };

  const parsed = parseLessonRef(ref);
  const found = parsed ? findLessonByNumbers(ctx.chapters as unknown as ChapterWithLessons[], parsed.chapterNumber, parsed.lessonNumber) : null;
  const lesson = found ? (ctx.flat.find((l) => l.id === found.id) ?? null) : null;

  if (!lesson) {
    const gated = course.enforceLessonCompletion && ctx.enrolled && !ctx.manager;
    if (gated) return { kind: "missing", ctx, resume: pickResumeLesson(ctx) };
    return { kind: "redirect", href: `/courses/${course.slug}` };
  }
  if (lesson.locked) {
    if (lesson.lockReason === "sequential") return { kind: "locked", ctx, lesson, resume: pickResumeLesson(ctx) };
    return { kind: "no_preview", ctx, lesson };
  }

  const db = await getDb();
  const index = ctx.flat.findIndex((l) => l.id === lesson.id);
  const chapter = ctx.chapters[lesson.chapterNumber - 1]!;
  const instructors = await getPublicUsers(course.instructorIds);

  const certificate =
    viewer && db.settings.features.certifications
      ? (db.certificates.find((c) => c.userId === viewer.id && c.courseId === course.id && c.published) ?? null)
      : null;

  const watches: Record<string, VideoWatchInfo> = {};
  if (viewer) {
    for (const w of db.videoWatches) {
      if (w.userId === viewer.id && w.lessonId === lesson.id) {
        watches[w.blockId] = { lastPositionSeconds: w.lastPositionSeconds, maxPositionSeconds: w.maxPositionSeconds, completed: w.completed };
      }
    }
  }

  const quizIds = new Set<string>();
  for (const block of lesson.blocks) {
    if (block.type === "quiz") quizIds.add(block.quizId);
    if (block.type === "video") for (const m of block.quizMarkers ?? []) quizIds.add(m.quizId);
  }
  const quizTitles: Record<string, string> = {};
  for (const quiz of db.quizzes) if (quizIds.has(quiz.id)) quizTitles[quiz.id] = quiz.title;
  const passedQuizIds = viewer
    ? Array.from(new Set(db.quizSubmissions.filter((s) => s.userId === viewer.id && s.passed && quizIds.has(s.quizId)).map((s) => s.quizId)))
    : [];

  return {
    kind: "ok",
    ctx,
    lesson,
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
    index,
    total: ctx.flat.length,
    prev: index > 0 ? ctx.flat[index - 1]! : null,
    next: index < ctx.flat.length - 1 ? ctx.flat[index + 1]! : null,
    instructors,
    certificate,
    watches,
    passedQuizIds,
    quizTitles,
  };
}

/* ------------------------------------------------------------------ */
/* Notes                                                                */
/* ------------------------------------------------------------------ */

export async function getLessonNotes(userId: string, lessonId: string): Promise<NoteItem[]> {
  const db = await getDb();
  return db.notes
    .filter((n) => n.userId === userId && n.lessonId === lessonId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({
      id: n.id,
      color: n.color,
      note: n.note,
      highlightedText: n.highlightedText,
      timestampSeconds: n.timestampSeconds,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
}

/* ------------------------------------------------------------------ */
/* Discussions                                                          */
/* ------------------------------------------------------------------ */

export function toUserChip(user: PublicUser | User | null | undefined): UserChip | null {
  if (!user) return null;
  return { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl };
}

function wasEdited(createdAt: string, updatedAt: string): boolean {
  return new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 1000;
}

/** Topics referencing a lesson (newest activity first) with their replies. */
export async function getLessonTopics(lessonId: string, course: Course, viewerId: string | null): Promise<TopicItem[]> {
  const db = await getDb();
  return buildTopics(db, (t) => t.refType === "lesson" && t.refId === lessonId, course.instructorIds, viewerId);
}

function buildTopics(
  db: Database,
  predicate: (t: Database["discussionTopics"][number]) => boolean,
  instructorIds: string[],
  viewerId: string | null,
): TopicItem[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  const chip = (id: string) => {
    const user = users.get(id);
    return user ? toUserChip(toPublicUser(user)) : null;
  };
  const instructors = new Set(instructorIds);
  const topics = db.discussionTopics.filter(predicate);
  const topicIds = new Set(topics.map((t) => t.id));
  const repliesByTopic = new Map<string, ReplyItem[]>();
  for (const r of db.discussionReplies) {
    if (!topicIds.has(r.topicId)) continue;
    const list = repliesByTopic.get(r.topicId) ?? [];
    list.push({
      id: r.id,
      topicId: r.topicId,
      author: chip(r.authorId),
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      edited: wasEdited(r.createdAt, r.updatedAt),
      isInstructor: instructors.has(r.authorId),
      isOwn: !!viewerId && r.authorId === viewerId,
    });
    repliesByTopic.set(r.topicId, list);
  }
  return topics
    .map((t) => ({
      id: t.id,
      title: t.title,
      author: chip(t.authorId),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      isOwn: !!viewerId && t.authorId === viewerId,
      replies: (repliesByTopic.get(t.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** People learners can @mention in lesson discussions: the course instructors. */
export async function getMentionableInstructors(course: Course): Promise<UserChip[]> {
  const users = await getPublicUsers(course.instructorIds);
  return users.map((u) => toUserChip(u)).filter((u): u is UserChip => !!u);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

/** Lessons with a quiz block keep discussions closed so answers stay private (Frappe rule). */
export function lessonHasQuiz(lesson: Pick<Lesson, "blocks">): boolean {
  return lesson.blocks.some((b) => b.type === "quiz");
}

export function lessonHasVideo(lesson: Pick<Lesson, "blocks">): boolean {
  return lesson.blocks.some((b) => b.type === "video");
}

/** Resolve a lesson id to its learn URL together with its course (for notifications). */
export async function getLessonLink(lessonId: string): Promise<{ href: string; course: Course; lesson: Lesson } | null> {
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return null;
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const chapterIndex = chapters.findIndex((c) => c.id === lesson.chapterId);
  const siblings = db.lessons.filter((l) => l.chapterId === lesson.chapterId).sort((a, b) => a.order - b.order);
  const lessonIndex = siblings.findIndex((l) => l.id === lesson.id);
  if (chapterIndex === -1 || lessonIndex === -1) return null;
  return { href: lessonHref(course.slug, { chapterNumber: chapterIndex + 1, lessonNumber: lessonIndex + 1 }), course, lesson };
}
