import "server-only";
import type { Chapter, Course, Database, Lesson, Notification, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { canManageCourse, flattenOutline, getCourseOutline, getViewerCourseState, lessonHref } from "@/lib/data/courses";
import {
  DAY_MS,
  dripAnchor,
  hasReleaseRule,
  prerequisiteMessage,
  releaseTime,
  unmetPrerequisites,
  type LessonLock,
  type PrerequisiteItem,
} from "@/components/learn/drip-shared";

/**
 * Drip (scheduled) content and course prerequisites — server side.
 *
 * The pure rules (release time, locking, prerequisite resolution, formatting)
 * live in `src/components/learn/drip-shared.ts` so the client can use them
 * too; this module adds everything that needs the database or the session:
 * the prerequisite gate used by enrollment and checkout, the course-page drip
 * overview and idempotent "new content unlocked" notifications.
 */

/* ------------------------------------------------------------------ */
/* Prerequisites                                                        */
/* ------------------------------------------------------------------ */

export type PrerequisiteGate = { ok: true; data: undefined } | { ok: false; error: string; missing: PrerequisiteItem[] };

/**
 * Gate for direct course enrollment and paid checkout: every prerequisite
 * course of `courseId` must be completed (`enrollment.completedAt`) by
 * `userId`. The result is shaped like an `ActionResult`, so actions can simply
 * `return gate` when it fails.
 *
 * Passes when the course has no (published) prerequisites, the user manages
 * the course, is already enrolled, or already paid for it (a purchase made
 * before prerequisites were added is honoured). Batch enrollment does not call
 * this gate: cohort membership is exempt by design.
 */
export async function assertPrerequisitesMet(userId: string, courseId: string): Promise<PrerequisiteGate> {
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  const user = db.users.find((u) => u.id === userId);
  if (!course || !user) return { ok: false, error: "This course is not available.", missing: [] };
  if (!course.prerequisiteCourseIds?.length) return { ok: true, data: undefined };
  if (canManageCourse(user, course)) return { ok: true, data: undefined };
  if (db.enrollments.some((e) => e.userId === userId && e.courseId === courseId)) return { ok: true, data: undefined };
  const paid = db.payments.some((p) => p.userId === userId && p.itemType === "course" && p.itemId === courseId && p.status === "paid");
  if (paid) return { ok: true, data: undefined };

  const { prerequisites } = getViewerCourseState(db, course, user);
  const missing = unmetPrerequisites(prerequisites);
  if (!missing.length) return { ok: true, data: undefined };
  return { ok: false, error: prerequisiteMessage(missing), missing };
}

export interface PrerequisiteStatus {
  items: PrerequisiteItem[];
  missing: PrerequisiteItem[];
  /** The viewer is blocked from enrolling / buying until `missing` is empty. */
  blocking: boolean;
}

/** Prerequisites of a course with the viewer's progress on each (guests get state "unknown"). */
export async function getPrerequisiteStatus(course: Course, viewer: User | null): Promise<PrerequisiteStatus> {
  const db = await getDb();
  const state = getViewerCourseState(db, course, viewer);
  return { items: state.prerequisites, missing: unmetPrerequisites(state.prerequisites), blocking: state.prerequisitesPending };
}

/* ------------------------------------------------------------------ */
/* Course overview (course page card)                                   */
/* ------------------------------------------------------------------ */

export interface DripNextUnlock {
  lessonId: string;
  title: string;
  href: string;
  chapterNumber: number;
  lessonNumber: number;
  /** ISO instant. */
  unlocksAt: string;
  afterPrevious: boolean;
}

export interface DripOverview {
  /** Lessons of the course that currently wait for their release time. */
  scheduledCount: number;
  /** The soonest scheduled lesson for this viewer. */
  nextUnlock: DripNextUnlock | null;
  /** Whether any chapter or lesson of the course has a release rule at all. */
  hasSchedule: boolean;
}

/** Scheduled-content summary for one viewer (used by the course page enroll card). */
export async function getDripOverview(course: Course, viewer: User | null, now: number = Date.now()): Promise<DripOverview> {
  const db = await getDb();
  const hasSchedule =
    db.chapters.some((c) => c.courseId === course.id && hasReleaseRule(c)) || db.lessons.some((l) => l.courseId === course.id && hasReleaseRule(l));
  if (!hasSchedule) return { scheduledCount: 0, nextUnlock: null, hasSchedule };

  const flat = flattenOutline(await getCourseOutline(course, viewer, now));
  let next: DripNextUnlock | null = null;
  let scheduledCount = 0;
  for (const lesson of flat) {
    const lock: LessonLock | undefined = lesson.lock;
    if (lock?.reason !== "drip" || !lock.unlocksAt) continue;
    scheduledCount++;
    if (!next || Date.parse(lock.unlocksAt) < Date.parse(next.unlocksAt)) {
      next = {
        lessonId: lesson.id,
        title: lesson.title,
        href: lessonHref(course.slug, lesson),
        chapterNumber: lesson.chapterNumber,
        lessonNumber: lesson.lessonNumber,
        unlocksAt: lock.unlocksAt,
        afterPrevious: !!lock.afterPrevious,
      };
    }
  }
  return { scheduledCount, nextUnlock: next, hasSchedule };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

/** Unlocks older than this are not announced (a learner returning after months gets no backlog). */
const NOTIFY_WINDOW_MS = 7 * DAY_MS;

/** Idempotency key stored in `Notification.dedupeKey` for a released chapter or lesson. */
export function dripNotificationKey(chapterOrLessonId: string): string {
  return `drip:${chapterOrLessonId}`;
}

interface PendingDripNotice {
  key: string;
  subject: string;
  message: string;
  link: string;
}

/**
 * Chapters and lessons that were released for `userId` within the notify
 * window and have not been opened yet. A chapter whose own schedule releases
 * several lessons at once produces one notification ("drip:<chapterId>");
 * lessons with a later schedule of their own get "drip:<lessonId>". Content
 * that was already available when the learner enrolled is never announced.
 */
function collectDueDripNotices(db: Database, userId: string, now: number): PendingDripNotice[] {
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.enabled) return [];
  const out: PendingDripNotice[] = [];

  for (const enrollment of db.enrollments) {
    if (enrollment.userId !== userId || enrollment.completedAt) continue;
    const course = db.courses.find((c) => c.id === enrollment.courseId);
    if (!course || canManageCourse(user, course)) continue;

    const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    const lessons = db.lessons.filter((l) => l.courseId === course.id);
    if (!chapters.some(hasReleaseRule) && !lessons.some(hasReleaseRule)) continue;

    const batch = enrollment.batchId ? db.batches.find((b) => b.id === enrollment.batchId) : null;
    const anchor = dripAnchor(enrollment, batch);
    if (!Number.isFinite(anchor)) continue;

    const opened = new Set(db.progress.filter((p) => p.userId === userId && p.courseId === course.id && p.status !== "incomplete").map((p) => p.lessonId));
    const recent = (t: number | null): t is number => t !== null && t > anchor && t <= now && now - t <= NOTIFY_WINDOW_MS;
    const previewsOpen = course.published && db.settings.learning.allowGuestAccess;
    // Same rule as the lesson player: open free previews ignore drip days.
    const lessonRelease = (chapter: Chapter, lesson: Lesson) => releaseTime(chapter, lesson, previewsOpen && lesson.includeInPreview ? null : anchor);

    chapters.forEach((chapter, ci) => {
      const chapterLessons = lessons.filter((l) => l.chapterId === chapter.id).sort((a, b) => a.order - b.order);
      if (!chapterLessons.length) return;
      const chapterRelease = releaseTime(chapter, null, anchor);

      if (recent(chapterRelease)) {
        const releasedWithChapter = chapterLessons
          .map((lesson, li) => ({ lesson, li }))
          .filter(({ lesson }) => lessonRelease(chapter, lesson) === chapterRelease);
        const first = releasedWithChapter.find(({ lesson }) => !opened.has(lesson.id));
        if (first) {
          const count = releasedWithChapter.length;
          out.push({
            key: dripNotificationKey(chapter.id),
            subject: `New chapter unlocked: ${chapter.title}`,
            message: `${course.title} · ${count} ${count === 1 ? "lesson is" : "lessons are"} now available.`,
            link: lessonHref(course.slug, { chapterNumber: ci + 1, lessonNumber: first.li + 1 }),
          });
        }
      }

      chapterLessons.forEach((lesson, li) => {
        const release = lessonRelease(chapter, lesson);
        if (!recent(release) || release === chapterRelease || opened.has(lesson.id)) return;
        out.push({
          key: dripNotificationKey(lesson.id),
          subject: `New lesson unlocked: ${lesson.title}`,
          message: `${course.title} · Chapter ${ci + 1}: ${chapter.title}`,
          link: lessonHref(course.slug, { chapterNumber: ci + 1, lessonNumber: li + 1 }),
        });
      });
    });
  }
  return out;
}

function sentDripKeys(db: Database, userId: string): Set<string> {
  const sent = new Set<string>();
  for (const n of db.notifications) if (n.userId === userId && n.dedupeKey?.startsWith("drip:")) sent.add(n.dedupeKey);
  return sent;
}

/**
 * In-app "new content unlocked" notifications for a learner's scheduled
 * (drip) chapters and lessons. There is no scheduler, so pages call this on
 * load (the lesson player does, through `getLearnContext`). It is idempotent:
 * every chapter/lesson is announced at most once per learner, keyed by
 * `Notification.dedupeKey = "drip:<id>"`, and it only writes when something is
 * due. Never throws; returns the number of notifications created.
 */
export async function ensureDripNotifications(userId: string, now: number = Date.now()): Promise<number> {
  if (!userId) return 0;
  try {
    const db = await getDb();
    if (!db.settings.features.notifications) return 0;
    const sent = sentDripKeys(db, userId);
    if (!collectDueDripNotices(db, userId, now).some((n) => !sent.has(n.key))) return 0;

    return await mutate((d) => {
      // Re-check inside the serialized write so concurrent page loads cannot double-send.
      const already = sentDripKeys(d, userId);
      const stamp = new Date(now).toISOString();
      let created = 0;
      for (const notice of collectDueDripNotices(d, userId, now)) {
        if (already.has(notice.key)) continue;
        already.add(notice.key);
        const n: Notification = {
          id: uid("ntf"),
          userId,
          type: "system",
          subject: notice.subject,
          message: notice.message,
          link: notice.link,
          read: false,
          dedupeKey: notice.key,
          createdAt: stamp,
        };
        d.notifications.push(n);
        created++;
      }
      return created;
    });
  } catch (err) {
    console.error("[drip] could not create unlock notifications", err instanceof Error ? err.message : err);
    return 0;
  }
}
