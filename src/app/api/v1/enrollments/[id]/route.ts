import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { notFound } from "@/lib/api/errors";
import { serializeDeleted } from "@/lib/api/serializers";
import { unenrollUserFromCourse } from "@/lib/services/enrollment";

/** DELETE /api/v1/enrollments/{id} — remove the enrollment and the learner's progress in that course. */
export const DELETE = apiRoute(endpoints.deleteEnrollment, async (ctx) => {
  const id = ctx.params.id!;
  const enrollment = ctx.db.enrollments.find((e) => e.id === id);
  if (!enrollment) throw notFound("enrollment", id);
  await unenrollUserFromCourse(enrollment.userId, enrollment.courseId);
  await ctx.audit("api.enrollment.delete", { type: "enrollment", id }, { userId: enrollment.userId, courseId: enrollment.courseId });
  const course = ctx.db.courses.find((c) => c.id === enrollment.courseId);
  revalidatePath(`/admin/courses/${enrollment.courseId}`, "layout");
  if (course) revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/dashboard");
  return dataResponse(serializeDeleted("enrollment", id));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("DELETE");
export const GET = unsupported;
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
