import "server-only";
import { revalidatePath } from "next/cache";
import type { Course, Database, Lesson, Notification } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { canManageCourse, lessonHref } from "@/lib/data/courses";
import { sendNotificationEmails } from "@/lib/services/notifications";
import { syncContentIndex } from "@/lib/seo/content-sync";
import { hasReleaseRule } from "@/components/learn/drip-shared";
import { pluralize, toDateKey, uid } from "@/lib/utils";
import { isLessonLive, planPublishSweep, sweepHasWork } from "./schedule-shared";
import { armPublishTimer } from "./scheduling";

/**
 * The publish sweep: writes down what the clock already decided.
 *
 *  - A scheduled course whose time has come gets `published: true` and its
 *    publish time removed, with the side effects of publishing by hand: the
 *    audit entry, the "new course" notification to members (Settings →
 *    Learning) and the "now live" note to its instructors the first time the
 *    course is published, and a search-engine ping through the SEO content sync.
 *  - A lesson whose time has come loses its publish time, and the learners of
 *    a live course are told about the new lesson.
 *
 * Exactly once: the flag, the removal of the publish time and the
 * notification rows are written in one serialized `mutate`, which re-plans
 * against the data as it is at that moment. A second sweep (another request,
 * another server entry, a retry) finds nothing left to do. Notifications also
 * carry a `dedupeKey`, so a course that is unpublished and scheduled again
 * does not announce itself twice.
 */

export interface PublishedCourse {
  id: string;
  slug: string;
  title: string;
  firstPublish: boolean;
}

export interface ReleasedLesson {
  id: string;
  courseId: string;
  title: string;
  /** Learners were told (the course is live and the lesson is not held back by a release schedule). */
  announced: boolean;
}

export interface PublishSweepResult {
  published: PublishedCourse[];
  released: ReleasedLesson[];
  /** In-app notifications created. */
  notifications: number;
}

const NOTHING: PublishSweepResult = { published: [], released: [], notifications: 0 };

export const coursePublishedKey = (courseId: string) => `course-published:${courseId}`;
export const lessonPublishedKey = (lessonId: string) => `lesson-published:${lessonId}`;

/** Collects notification rows, skipping users who already hold one with the same key. */
function notificationWriter(db: Pick<Database, "notifications">, stamp: string) {
  const rows: Notification[] = [];
  const sent = new Map<string, Set<string>>();
  const holders = (key: string) => {
    let set = sent.get(key);
    if (!set) {
      set = new Set(db.notifications.filter((n) => n.dedupeKey === key).map((n) => n.userId));
      sent.set(key, set);
    }
    return set;
  };
  const add = (userId: string, key: string, input: Pick<Notification, "type" | "subject" | "message" | "link" | "fromUserId">) => {
    const already = holders(key);
    if (already.has(userId)) return;
    already.add(userId);
    rows.push({ id: uid("ntf"), userId, ...input, read: false, dedupeKey: key, createdAt: stamp });
  };
  return { rows, add };
}

type Writer = ReturnType<typeof notificationWriter>;

/** The notifications of a first publish: members (per settings) and the course's instructors. */
function announceCourse(db: Database, course: Course, writer: Writer): void {
  const key = coursePublishedKey(course.id);
  const link = `/courses/${course.slug}`;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const instructors = new Set(course.instructorIds);
  if (db.settings.learning.notifyOnPublishedCourses !== "none") {
    const lead = users.get(course.instructorIds[0] ?? "")?.name ?? "An instructor";
    for (const user of db.users) {
      if (!user.enabled || instructors.has(user.id)) continue;
      writer.add(user.id, key, {
        type: "course_published",
        subject: `${lead} has published a new course ${course.title}`,
        message: course.shortIntroduction,
        link,
        fromUserId: course.instructorIds[0],
      });
    }
  }
  for (const id of instructors) {
    if (!users.get(id)?.enabled) continue;
    writer.add(id, key, { type: "course_published", subject: `${course.title} is now live`, message: "Your course was published at its scheduled time.", link });
  }
}

/**
 * Tell the learners of a live course about lessons that just appeared: one
 * notification per learner and course, linking to the first new lesson.
 * Lessons still held back by a release schedule (drip) are left to the
 * "unlocked" notifications of that schedule. Returns the announced lesson ids.
 */
function announceLessons(db: Database, course: Course, lessons: Lesson[], now: number, writer: Writer): Set<string> {
  const announced = new Set<string>();
  if (!course.published || !db.settings.features.notifications) return announced;
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  // Positions as learners see them: lessons that are still hidden do not count.
  const visible = db.lessons.filter((l) => l.courseId === course.id && isLessonLive(l, now));
  const located = lessons
    .map((lesson) => {
      const ci = chapters.findIndex((c) => c.id === lesson.chapterId);
      const chapter = chapters[ci];
      if (!chapter || hasReleaseRule(lesson) || hasReleaseRule(chapter)) return null;
      const li = visible
        .filter((l) => l.chapterId === chapter.id)
        .sort((a, b) => a.order - b.order)
        .findIndex((l) => l.id === lesson.id);
      return li === -1 ? null : { lesson, chapter, ci, li };
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => a.ci - b.ci || a.li - b.li);
  const first = located[0];
  if (!first) return announced;
  for (const row of located) announced.add(row.lesson.id);

  const users = new Map(db.users.map((u) => [u.id, u]));
  const opened = new Set(db.progress.filter((p) => p.lessonId === first.lesson.id && p.status !== "incomplete").map((p) => p.userId));
  const subject = located.length === 1 ? `New lesson: ${first.lesson.title}` : `${pluralize(located.length, "new lesson")} in ${course.title}`;
  const message = located.length === 1 ? `${course.title} · Chapter ${first.ci + 1}: ${first.chapter.title}` : `Starting with “${first.lesson.title}” in chapter ${first.ci + 1}: ${first.chapter.title}.`;
  for (const enrollment of db.enrollments) {
    if (enrollment.courseId !== course.id) continue;
    const user = users.get(enrollment.userId);
    if (!user?.enabled || canManageCourse(user, course) || opened.has(user.id)) continue;
    writer.add(user.id, lessonPublishedKey(first.lesson.id), {
      type: "system",
      subject,
      message,
      link: lessonHref(course.slug, { chapterNumber: first.ci + 1, lessonNumber: first.li + 1 }),
    });
  }
  return announced;
}

interface Applied extends Omit<PublishSweepResult, "notifications"> {
  rows: Notification[];
  nextAt: number | null;
}

/** Write the plan. Runs inside `mutate`, so it sees (and changes) the data no other sweep can touch meanwhile. */
function applySweep(db: Database, now: number): Applied {
  const plan = planPublishSweep(db.courses, db.lessons, now);
  const stamp = new Date(now).toISOString();
  const writer = notificationWriter(db, stamp);
  const published: PublishedCourse[] = [];
  const released: ReleasedLesson[] = [];

  const clear = new Set(plan.clear);
  const publish = new Set(plan.publish);
  for (const course of db.courses) {
    if (clear.has(course.id)) {
      delete course.publishAt;
      continue;
    }
    if (!publish.has(course.id)) continue;
    const firstPublish = !course.publishedOn;
    course.published = true;
    course.publishedOn ??= toDateKey(new Date(now));
    course.updatedAt = stamp;
    delete course.publishAt;
    published.push({ id: course.id, slug: course.slug, title: course.title, firstPublish });
    if (firstPublish) announceCourse(db, course, writer);
  }

  const release = new Set(plan.release);
  const byCourse = new Map<string, Lesson[]>();
  for (const lesson of db.lessons) {
    if (!release.has(lesson.id)) continue;
    delete lesson.publishAt;
    const list = byCourse.get(lesson.courseId) ?? [];
    list.push(lesson);
    byCourse.set(lesson.courseId, list);
  }
  for (const [courseId, lessons] of byCourse) {
    const course = db.courses.find((c) => c.id === courseId);
    const announced = course ? announceLessons(db, course, lessons, now, writer) : new Set<string>();
    for (const lesson of lessons) released.push({ id: lesson.id, courseId, title: lesson.title, announced: announced.has(lesson.id) });
  }

  if (writer.rows.length) db.notifications.push(...writer.rows);
  return { published, released, rows: writer.rows, nextAt: planPublishSweep(db.courses, db.lessons, now).nextAt };
}

function revalidate(result: Applied, courses: Map<string, Pick<Course, "id" | "slug">>): void {
  try {
    const touched = new Set([...result.published.map((c) => c.id), ...result.released.map((l) => l.courseId)]);
    for (const id of touched) {
      const course = courses.get(id);
      if (!course) continue;
      revalidatePath(`/admin/courses/${course.id}`, "layout");
      revalidatePath(`/courses/${course.slug}`, "layout");
    }
    if (result.published.length) {
      revalidatePath("/admin/courses");
      revalidatePath("/courses");
      revalidatePath("/dashboard");
    }
  } catch {
    // Not every caller may revalidate (a render, the timer). These pages are rendered per request anyway.
  }
}

/**
 * Publish every scheduled course and lesson whose time has passed, with their
 * side effects. Safe to call at any time and from anywhere; does nothing (and
 * writes nothing) when no schedule is due.
 */
export async function runPublishSweep(now: number = Date.now()): Promise<PublishSweepResult> {
  const db = await getDb();
  const plan = planPublishSweep(db.courses, db.lessons, now);
  if (!sweepHasWork(plan)) {
    armPublishTimer(plan.nextAt);
    return NOTHING;
  }

  const result = await mutate((d) => applySweep(d, now));
  armPublishTimer(result.nextAt);

  if (result.rows.length) await sendNotificationEmails(result.rows);
  for (const course of result.published) {
    await audit(null, "course.publish", { type: "course", id: course.id }, { title: course.title, firstPublish: course.firstPublish, scheduled: true });
  }
  for (const lesson of result.released) {
    await audit(null, "lesson.publish", { type: "lesson", id: lesson.id }, { title: lesson.title, courseId: lesson.courseId, scheduled: true, announced: lesson.announced });
  }
  revalidate(result, new Map((await getDb()).courses.map((c) => [c.id, c])));
  // New public pages go to the search engines (IndexNow) through the same sync every other content change uses.
  if (result.published.length) await syncContentIndex({ force: true });
  return { published: result.published, released: result.released, notifications: result.rows.length };
}
