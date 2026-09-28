import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { buildCourseExport } from "@/lib/data/admin-courses";

/** GET /admin/courses/:id/export — download the course as a portable JSON file. */
export async function GET(req: Request, ctx: RouteContext<"/admin/courses/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    const login = new URL(`/login?next=${encodeURIComponent(`/admin/courses/${id}?tab=export`)}`, req.url);
    return NextResponse.redirect(login);
  }
  const course = await findById("courses", id);
  if (!course) return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  if (!canManageCourse(user, course)) return NextResponse.json({ ok: false, error: "You do not have permission to export this course." }, { status: 403 });

  const file = await buildCourseExport(course);
  const body = JSON.stringify(file, null, 2);
  const filename = `${course.slug || "course"}.json`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
