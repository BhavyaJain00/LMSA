import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, listResponse } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { findCourse, resolveMember } from "@/lib/api/lookups";
import { listPage } from "@/lib/api/pagination";
import { enrollmentStamps, lastProgressByEnrollment, serializeEnrollment } from "@/lib/api/serializers";
import { enrollUserInCourse } from "@/lib/services/enrollment";

/** GET /api/v1/enrollments — course enrollments, filterable and paginated. */
export const GET = apiRoute(endpoints.listEnrollments, async ({ db, query, url }) => {
  const rows = db.enrollments.filter(
    (e) =>
      (!query.userId || e.userId === query.userId) &&
      (!query.courseId || e.courseId === query.courseId) &&
      (query.completed === undefined || !!e.completedAt === query.completed) &&
      (!query.memberType || e.memberType === query.memberType),
  );
  const lastProgress = lastProgressByEnrollment(db.progress);
  return listResponse(
    listPage(rows, (e) => enrollmentStamps(e, lastProgress), query),
    url,
    serializeEnrollment,
  );
});

/** POST /api/v1/enrollments — enroll a member (by id or email) in a course. Idempotent. */
export const POST = apiRoute(endpoints.createEnrollment, async (ctx) => {
  const { db, body } = ctx;
  const user = resolveMember(db, body);
  const course = findCourse(db, body.courseId);
  const existing = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  if (existing) return dataResponse(serializeEnrollment(existing), 200);

  const enrollment = await enrollUserInCourse(user.id, course.id, {
    memberType: body.memberType ?? "student",
    confirmationEmail: body.sendConfirmationEmail ?? false,
  });
  await ctx.audit("api.enrollment.create", { type: "enrollment", id: enrollment.id }, { userId: user.id, courseId: course.id, memberType: enrollment.memberType });
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath(`/courses/${course.slug}`, "layout");
  return dataResponse(serializeEnrollment(enrollment), 201);
});
