import { apiRoute, dataResponse, listResponse } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { afterCourseWrite, buildCourseChanges, insertCourse, newCourse } from "@/lib/api/courses";
import { courseLookups, matchesText } from "@/lib/api/lookups";
import { listPage } from "@/lib/api/pagination";
import { courseStamps, serializeCourse, serializeCourseDetail } from "@/lib/api/serializers";
import { getDb } from "@/lib/db/store";

/** GET /api/v1/courses — every course (drafts included), filterable and paginated. */
export const GET = apiRoute(endpoints.listCourses, async ({ db, query, url, baseUrl }) => {
  const tag = query.tag?.toLowerCase();
  const rows = db.courses.filter(
    (c) =>
      matchesText(query.q, c.title, c.slug, c.shortIntroduction, c.tags.join(" ")) &&
      (query.published === undefined || c.published === query.published) &&
      (!query.categoryId || c.categoryId === query.categoryId) &&
      (!query.instructorId || c.instructorIds.includes(query.instructorId)) &&
      (!tag || c.tags.some((t) => t.toLowerCase() === tag)),
  );
  const lookups = courseLookups(db, baseUrl);
  return listResponse(listPage(rows, courseStamps, query), url, (course) => serializeCourse(course, lookups));
});

/** POST /api/v1/courses — create a course. */
export const POST = apiRoute(endpoints.createCourse, async (ctx) => {
  const { db, body, actorId } = ctx;
  const changes = buildCourseChanges(db, body, null, actorId);
  const course = await insertCourse(newCourse(db, changes, actorId));
  await ctx.audit("api.course.create", { type: "course", id: course.id }, { title: course.title, published: course.published });
  afterCourseWrite(course);
  const fresh = await getDb();
  return dataResponse(serializeCourseDetail(course, fresh.chapters, fresh.lessons, courseLookups(fresh, ctx.baseUrl), ctx.can("courses:write")), 201);
});
