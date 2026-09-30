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
import type { LessonKind, LockReason, MentionOption, NoteItem, OutlineChapterItem, ReplyItem, TopicItem, UserChip } from "@/components/learn/types";
import { cache } from "react";
import { getDb } from "@/lib/db/store";
import { isStaff, toPublicUser } from "@/lib/auth/session";
import { canManageCourse, findLessonByNumbers, getCourseBySlug, getCourseOutline, getViewerCourseState, lessonHref, parseLessonRef } from "./courses";
import { getPublicUsers, listUsers } from "./users";
import { percent } from "@/lib/utils";
import { ensureDripNotifications } from "@/lib/services/drip";
import { enrollmentGrantsAccess } from "@/lib/commerce/access";
import {
  computeLessonLocks,
  legacyLockReason,
  nextUnlockTime,
  pickContinueLesson,
  unmetPrerequisites,
  type LessonLock,
  type LessonNeighborWithLock,
  type LockedLessonState,
  type OutlineLessonWithLock,
  type PrerequisiteItem,
} from "@/components/learn/drip-shared";

/**
 * Data access for the lesson player (/courses/[slug]/learn/[ref]).
 *
 * Access rules (Frappe LMS get_lesson plus round-2 drip content):
 *  - Course managers (instructors, moderators, admins) can open every lesson.
 *  - Enrolled learners can open every released lesson: scheduled (drip)
 *    lessons stay locked until their release time, and with
 *    `enforceLessonCompletion` every lesson after the first incomplete one is
 *    locked (lessons that are already complete never lock).
 *  - Everyone else can open only "include in preview" lessons, and only when
 *    the course is published and guest access is enabled in settings (a
 *    preview with a future `availableFrom` date waits for that date too).
 *
 * The locking itself is computed once, by `getCourseOutline` (courses.ts),
 * with the pure rules in `src/components/learn/drip-shared.ts`.
 */

/* ------------------------------------------------------------------ */
/* Outline with viewer-specific locking                                 */
/* ------------------------------------------------------------------ */

export interface LearnLesson extends LessonWithState {
  /** Legacy reason for existing consumers ("sequential" = enforced order, "enroll"); unset for drip locks. */
  lockReason?: LockReason;
  /** Detailed lock: drip (with `unlocksAt`), order, enroll or prerequisite. */
  lock?: LessonLock;
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
  /** Prerequisite courses of this course with the viewer's status. */
  prerequisites: PrerequisiteItem[];
  /** The soonest future drip unlock for this viewer (ISO), if any. */
  nextUnlockAt: string | null;
}

export interface LearnContextOptions {
  /**
   * Create due "new content unlocked" notifications for enrolled learners
   * (default true). Access checks from APIs and actions pass false so
   * heartbeats do not scan for notifications.
   */
  notify?: boolean;
  now?: number;
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

/**
 * Build the outline for a viewer with locking applied (free preview,
 * prerequisites, drip schedules, enforced order). For enrolled learners it
 * also creates due "new content unlocked" notifications (never throws).
 */
export async function getLearnContext(course: Course, viewer: User | null, options: LearnContextOptions = {}): Promise<LearnContext> {
  const now = options.now ?? Date.now();
  const [raw, db] = await Promise.all([getCourseOutline(course, viewer, now), getDb()]);
  const settings = db.settings;
  const state = getViewerCourseState(db, course, viewer);
  const { enrollment, manager, previewAllowed } = state;

  // Commerce (round 3): an enrollment opened through a membership unlocks lessons only while a
  // membership covering the course is running. Once it lapses the learner sees the course like a
  // visitor (free previews only); progress is kept and everything reopens when they rejoin or buy.
  const lapsed = !!enrollment && !manager && !enrollmentGrantsAccess(db, enrollment, now);
  const enrolled = state.enrolled && !lapsed;
  let visitorLocks: Map<string, LessonLock | null> | null = null;
  if (lapsed) {
    const rows = raw.flatMap((chapter) =>
      chapter.lessons.map((lesson) => ({
        id: lesson.id,
        status: lesson.status,
        includeInPreview: lesson.includeInPreview,
        dripDays: lesson.dripDays,
        availableFrom: lesson.availableFrom,
        chapter: { dripDays: chapter.dripDays, availableFrom: chapter.availableFrom },
      })),
    );
    const locks = computeLessonLocks(rows, {
      manager: false,
      enrolled: false,
      previewAllowed,
      enforceOrder: course.enforceLessonCompletion,
      anchor: null,
      prerequisitesPending: false,
      now,
    });
    visitorLocks = new Map(rows.map((row, i) => [row.id, locks[i] ?? null]));
  }

  const chapters: LearnChapter[] = raw.map((chapter, ci) => ({
    ...chapter,
    number: ci + 1,
    lessons: chapter.lessons.map((lesson): LearnLesson => {
      const { lock: ownLock, ...rest } = lesson;
      const lock = visitorLocks ? (visitorLocks.get(lesson.id) ?? undefined) : ownLock;
      return {
        ...rest,
        locked: !!lock,
        ...(lock ? { lock } : {}),
        lockReason: legacyLockReason(lock),
        href: lessonHref(course.slug, lesson),
        kind: lessonKind(lesson),
      };
    }),
  }));

  const flat = chapters.flatMap((c) => c.lessons);
  const completed = flat.filter((l) => l.status === "complete").length;
  const nextUnlock = nextUnlockTime(
    flat.map((l) => l.lock),
    now,
  );

  if (viewer && enrolled && !manager && options.notify !== false) {
    // Wrapped: notifications must never break the lesson player.
    await ensureDripNotifications(viewer.id, now).catch(() => 0);
  }

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
    prerequisites: state.prerequisites,
    nextUnlockAt: nextUnlock !== null ? new Date(nextUnlock).toISOString() : null,
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

/** Client outline row. Carries the detailed `lock` (drip time etc.) next to the legacy fields. */
function toOutlineLesson(lesson: LearnLesson): OutlineLessonWithLock {
  return {
    id: lesson.id,
    title: lesson.title,
    href: lesson.href,
    chapterNumber: lesson.chapterNumber,
    lessonNumber: lesson.lessonNumber,
    status: lesson.status,
    locked: lesson.locked,
    lockReason: lesson.lockReason,
    ...(lesson.lock ? { lock: lesson.lock } : {}),
    durationSeconds: lesson.durationSeconds,
    kind: lesson.kind,
    preview: lesson.includeInPreview,
  };
}

export function toNeighbor(lesson: LearnLesson | null | undefined): LessonNeighborWithLock | null {
  if (!lesson) return null;
  return {
    id: lesson.id,
    title: lesson.title,
    href: lesson.href,
    status: lesson.status,
    locked: lesson.locked,
    lockReason: lesson.lockReason,
    ...(lesson.lock ? { lock: lesson.lock } : {}),
    chapterNumber: lesson.chapterNumber,
    lessonNumber: lesson.lessonNumber,
  };
}

/**
 * Where "continue learning" should take the viewer: the lesson they last
 * opened (when it is still unlocked and not complete), else the first
 * unlocked incomplete lesson. Never a locked lesson, and never a finished one
 * while later lessons are still scheduled: when nothing is open yet, or the
 * learner has completed everything released so far, the result is null and
 * callers fall back to the course page (which shows when the next lesson
 * unlocks). Once the whole course is done, the first lesson (for review).
 */
export function pickResumeLesson(ctx: Pick<LearnContext, "flat" | "enrollment">): LearnLesson | null {
  return pickContinueLesson(ctx.flat, ctx.enrollment?.currentLessonId);
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
  /** Legacy reason ("sequential" / "enroll"); unset for drip locks. */
  lockReason?: LockReason;
  /** Detailed lock: drip (with `unlocksAt`), order, enroll or prerequisite. */
  lock?: LessonLock;
  status: LearnLesson["status"];
  href: string;
}

/**
 * Resolve everything needed to authorize an action on a lesson. `canView` is
 * false while the lesson is locked for the viewer for any reason (not
 * enrolled, prerequisites, drip schedule, enforced order), so every caller
 * (lesson progress API, completion, notes, discussions, assessments, media
 * signing) rejects locked lessons consistently.
 */
export async function getLessonAccess(user: User | null, lessonId: string): Promise<LessonAccess | null> {
  if (!lessonId) return null;
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return null;
  const ctx = await getLearnContext(course, user, { notify: false });
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
    ...(item.lock ? { lock: item.lock } : {}),
    status: item.status,
    href: item.href,
  };
}

/**
 * Human-readable refusal for a locked lesson (used by the lesson progress API
 * and the completion action). Drip locks mention the release time in UTC;
 * the lesson page itself shows the viewer's local time.
 */
export function lockedLessonError(access: Pick<LessonAccess, "lock" | "enrolled">): string {
  const lock = access.lock;
  if (!lock) return "You do not have access to this lesson.";
  switch (lock.reason) {
    case "drip": {
      const at = lock.unlocksAt ? new Date(lock.unlocksAt) : null;
      const when = at && !Number.isNaN(at.getTime()) ? ` It unlocks on ${at.toUTCString().replace(/:\d\d GMT$/, " UTC")}.` : "";
      return `This lesson is not available yet.${when}`;
    }
    case "order":
      return "Complete the previous lesson before marking this one as done.";
    case "prerequisite":
      return "Complete the prerequisite courses and enroll to open this lesson.";
    case "enroll":
      return access.enrolled ? "You do not have access to this lesson." : "Enroll in this course to open this lesson.";
  }
}

/**
 * Why an assessment embedded in `lessonId` can't be submitted from that lesson
 * right now (drip schedule, enforced order, prerequisites, not enrolled), or
 * null when the lesson is open to the user. Assignment and exercise
 * submissions call this so locked lessons can't be worked around.
 */
export async function lessonSubmissionLockError(user: User | null, lessonId: string, noun: "quiz" | "assignment" | "exercise"): Promise<string | null> {
  const access = await getLessonAccess(user, lessonId);
  if (!access || access.canView) return null;
  return assessmentLockMessage(access, noun);
}

function assessmentLockMessage(access: LessonAccess, noun: "quiz" | "assignment" | "exercise"): string {
  if (access.lock && access.lock.reason !== "order") return lockedLessonError(access);
  if (access.locked) return `Complete the previous lessons to unlock this ${noun}.`;
  return "You do not have access to this lesson.";
}

export type AssessmentAccess =
  | {
      ok: true;
      /** Lessons embedding the assessment that the user can open (the only ones a submission may name). */
      openLessonIds: string[];
    }
  | {
      ok: false;
      message: string;
      /** Course page of a lesson that embeds it, for a "View course" link. */
      courseHref: string | null;
    };

/**
 * Who may open and submit a standalone assignment or exercise page
 * (`/assignments/[id]`, `/exercises/[id]`) — the same rules as quizzes:
 *  - staff (they author, test and grade assessments);
 *  - when lessons embed it: learners who can open at least one of those
 *    lessons right now (enrolled, released, in order, prerequisites met), so
 *    an assessment inside a scheduled or locked lesson can't be read or
 *    submitted early from its own URL;
 *  - instructors and members of a batch whose assessments list it;
 *  - an assessment that no lesson embeds keeps its open behaviour (anyone
 *    logged in).
 */
export async function getAssessmentAccess(user: User, kind: "assignment" | "exercise", refId: string): Promise<AssessmentAccess> {
  const db = await getDb();
  const embedding = db.lessons.filter((l) =>
    l.blocks.some((b) => (kind === "assignment" ? b.type === "assignment" && b.assignmentId === refId : b.type === "exercise" && b.exerciseId === refId)),
  );
  if (isStaff(user)) return { ok: true, openLessonIds: embedding.map((l) => l.id) };

  const openLessonIds: string[] = [];
  let blocked: LessonAccess | null = null;
  for (const lesson of embedding) {
    const access = await getLessonAccess(user, lesson.id);
    if (!access) continue; // orphaned lesson (its course is gone): not a placement
    if (access.canView) openLessonIds.push(lesson.id);
    else blocked ??= access;
  }
  if (openLessonIds.length || !blocked) return { ok: true, openLessonIds };

  const viaBatch = db.batches.some(
    (b) =>
      b.assessments.some((a) => a.type === kind && a.refId === refId) &&
      (b.instructorIds.includes(user.id) || db.batchEnrollments.some((m) => m.batchId === b.id && m.userId === user.id)),
  );
  if (viaBatch) return { ok: true, openLessonIds };
  return { ok: false, message: assessmentLockMessage(blocked, kind), courseHref: `/courses/${blocked.course.slug}` };
}

/* ------------------------------------------------------------------ */
/* Locked lesson (request-scoped)                                       */
/* ------------------------------------------------------------------ */

/**
 * The drip/prerequisite lock of the lesson the current request is rendering,
 * recorded by `getLessonPageData` so the locked-lesson notice can show the
 * countdown or the prerequisite list. React `cache` scopes it to one request.
 */
const lockedLessonSlot = cache((): { current: LockedLessonState | null } => ({ current: null }));

/** The locked lesson recorded for this request (null outside a locked lesson page). */
export function getRequestLockedLesson(): LockedLessonState | null {
  return lockedLessonSlot().current;
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
  | (LessonPageBase & {
      kind: "locked";
      lesson: LearnLesson;
      resume: LearnLesson | null;
      /** Drip or prerequisite details for the locked-lesson notice (null for enforced order). */
      lockState: LockedLessonState | null;
    })
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
    const reason = lesson.lock?.reason ?? (lesson.lockReason === "sequential" ? "order" : "enroll");
    if (reason === "enroll") return { kind: "no_preview", ctx, lesson };
    const lockState: LockedLessonState | null =
      lesson.lock && (reason === "drip" || reason === "prerequisite")
        ? {
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            lock: lesson.lock,
            prerequisites: reason === "prerequisite" ? unmetPrerequisites(ctx.prerequisites) : [],
          }
        : null;
    lockedLessonSlot().current = lockState;
    return { kind: "locked", ctx, lesson, resume: pickResumeLesson(ctx), lockState };
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

/**
 * Whether a discussion author may @mention any enabled user (Frappe: mentions
 * for non-students). Staff roles and the course's own instructors/managers can;
 * learners are limited to people in the course.
 */
export function canMentionAnyone(user: Pick<User, "id" | "roles">, course: Course): boolean {
  return isStaff(user) || course.instructorIds.includes(user.id) || canManageCourse(user, course);
}

/**
 * Everyone `viewer` may @mention in this course's lesson discussions, excluding
 * the viewer. Staff and instructors get every enabled user; learners get the
 * course instructors and enrolled members. Instructors come first, then by name.
 * The discussion actions resolve @username against this same list, so what the
 * composer suggests and who gets notified never disagree.
 */
export async function getMentionCandidates(course: Course, viewer: Pick<User, "id" | "roles">): Promise<MentionOption[]> {
  const [users, db] = await Promise.all([listUsers(), getDb()]);
  const instructors = new Set(course.instructorIds);
  let allowed: Set<string> | null = null;
  if (!canMentionAnyone(viewer, course)) {
    allowed = new Set(instructors);
    for (const e of db.enrollments) if (e.courseId === course.id) allowed.add(e.userId);
  }
  return users
    .filter((u) => u.enabled && u.id !== viewer.id && (!allowed || allowed.has(u.id)))
    .map((u) => ({ id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl, isInstructor: instructors.has(u.id) }))
    .sort((a, b) => Number(b.isInstructor) - Number(a.isInstructor) || a.name.localeCompare(b.name));
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
