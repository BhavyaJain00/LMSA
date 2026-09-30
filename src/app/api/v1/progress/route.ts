import type { Database, Lesson, LessonProgress } from "@/lib/types";
import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { notFound } from "@/lib/api/errors";
import { listPage } from "@/lib/api/pagination";
import { enrollmentStamps, lastProgressByEnrollment, serializeProgress } from "@/lib/api/serializers";

/** A course's lessons in outline order (chapter order, then lesson order). */
function orderedLessons(db: Database, courseId: string): Lesson[] {
  const chapterOrder = new Map(db.chapters.filter((c) => c.courseId === courseId).map((c) => [c.id, c.order]));
  return db.lessons
    .filter((l) => l.courseId === courseId && chapterOrder.has(l.chapterId))
    .sort((a, b) => chapterOrder.get(a.chapterId)! - chapterOrder.get(b.chapterId)! || a.order - b.order);
}

/** GET /api/v1/progress — per-enrollment progress with every lesson's status. */
export const GET = apiRoute(endpoints.listProgress, async ({ db, query, url }) => {
  if (query.userId && !db.users.some((u) => u.id === query.userId)) throw notFound("user", query.userId);
  if (query.courseId && !db.courses.some((c) => c.id === query.courseId)) throw notFound("course", query.courseId);

  const enrollments = db.enrollments.filter(
    (e) =>
      (!query.userId || e.userId === query.userId) &&
      (!query.courseId || e.courseId === query.courseId) &&
      (query.completed === undefined || !!e.completedAt === query.completed),
  );
  const lastProgress = lastProgressByEnrollment(db.progress);
  const page = listPage(enrollments, (e) => enrollmentStamps(e, lastProgress), query);

  // Only the lessons and progress rows of the enrollments on this page are needed.
  const wanted = new Set(page.items.map((e) => `${e.userId}:${e.courseId}`));
  const rowsByEnrollment = new Map<string, LessonProgress[]>();
  for (const row of db.progress) {
    const key = `${row.userId}:${row.courseId}`;
    if (!wanted.has(key)) continue;
    const list = rowsByEnrollment.get(key) ?? [];
    list.push(row);
    rowsByEnrollment.set(key, list);
  }
  const lessonsByCourse = new Map<string, Lesson[]>();
  const lessonsFor = (courseId: string) => {
    let lessons = lessonsByCourse.get(courseId);
    if (!lessons) lessonsByCourse.set(courseId, (lessons = orderedLessons(db, courseId)));
    return lessons;
  };

  return listResponse(page, url, (e) => serializeProgress(e, lessonsFor(e.courseId), rowsByEnrollment.get(`${e.userId}:${e.courseId}`) ?? []));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
