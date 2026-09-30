import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { afterCourseWrite, applyCourseChanges, buildCourseChanges } from "@/lib/api/courses";
import { courseLookups, findCourse } from "@/lib/api/lookups";
import { serializeCourseDetail } from "@/lib/api/serializers";
import { getDb } from "@/lib/db/store";

/** GET /api/v1/courses/{id} — a course (by id or slug) with its outline. */
export const GET = apiRoute(endpoints.getCourse, async ({ db, params, baseUrl, can }) => {
  const course = findCourse(db, params.id!);
  return dataResponse(serializeCourseDetail(course, db.chapters, db.lessons, courseLookups(db, baseUrl), can("courses:write")));
});

/** PATCH /api/v1/courses/{id} — update the fields sent. */
export const PATCH = apiRoute(endpoints.updateCourse, async (ctx) => {
  const { db, params, body, actorId } = ctx;
  const course = findCourse(db, params.id!);
  const changes = buildCourseChanges(db, body, course, actorId);
  const { before, after } = await applyCourseChanges(course.id, changes);

  const changed = (Object.keys(changes) as (keyof typeof changes)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  await ctx.audit("api.course.update", { type: "course", id: after.id }, { title: after.title, fields: changed.join(", ") || "none" });
  if (before.published !== after.published) {
    await ctx.audit(after.published ? "course.publish" : "course.unpublish", { type: "course", id: after.id }, { title: after.title });
  }
  afterCourseWrite(after, before.slug);
  const fresh = await getDb();
  return dataResponse(serializeCourseDetail(after, fresh.chapters, fresh.lessons, courseLookups(fresh, ctx.baseUrl), ctx.can("courses:write")));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET", "PATCH");
export const POST = unsupported;
export const PUT = unsupported;
export const DELETE = unsupported;
