import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { getLessonVideoAnalytics } from "@/lib/media/analytics";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/video-progress/retention?lesson=<lessonId>
 *
 * Retention analytics for the videos of one lesson (used by the lesson
 * editor's "Video statistics" dialog). Course managers only.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to view video statistics." }, { status: 401, headers: NO_STORE });
  const lessonId = (req.nextUrl.searchParams.get("lesson") ?? "").trim();
  if (!/^[\w-]{1,64}$/.test(lessonId)) return NextResponse.json({ ok: false, error: "Invalid lesson." }, { status: 400, headers: NO_STORE });

  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  const course = lesson ? db.courses.find((c) => c.id === lesson.courseId) : undefined;
  if (!lesson || !course) return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404, headers: NO_STORE });
  if (!canManageCourse(user, course)) return NextResponse.json({ ok: false, error: "Only course instructors can view video statistics." }, { status: 403, headers: NO_STORE });

  const analytics = await getLessonVideoAnalytics(lesson.id);
  if (!analytics) return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    { ok: true, courseId: analytics.courseId, analyticsHref: `/admin/courses/${analytics.courseId}/video-analytics`, videos: analytics.videos },
    { headers: NO_STORE },
  );
}
