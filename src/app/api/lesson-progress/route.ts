import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getLessonAccess } from "@/lib/data/lessons";
import { getCompletionRequirements, setLessonStatus } from "@/lib/services/progress";
import { clamp } from "@/lib/utils";

interface Body {
  lessonId?: unknown;
  dwellDelta?: unknown;
}

/** Longest gap we accept between two heartbeats (the client sends every 15s). */
const MAX_DELTA = 60;

/**
 * Dwell-time heartbeat for the lesson player.
 *
 * POST { lessonId, dwellDelta } (JSON or a text/plain beacon body).
 * Records that the learner viewed the lesson (status "partial" unless it is
 * already complete), adds the seconds spent on the page, moves the enrollment
 * "current lesson" pointer and logs a `lesson_view` activity. The response
 * tells the client whether every completion requirement is now met so it can
 * complete the lesson automatically once the dwell time is reached.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = JSON.parse(await req.text()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const lessonId = typeof body.lessonId === "string" ? body.lessonId.trim() : "";
  if (!lessonId) return NextResponse.json({ ok: false, error: "Missing lessonId" }, { status: 400 });
  const rawDelta = typeof body.dwellDelta === "number" ? body.dwellDelta : Number(body.dwellDelta);
  const dwellDelta = Number.isFinite(rawDelta) ? clamp(Math.round(rawDelta), 0, MAX_DELTA) : 0;

  const access = await getLessonAccess(user, lessonId);
  if (!access) return NextResponse.json({ ok: false, error: "Lesson not found" }, { status: 404 });
  if (!access.enrolled) return NextResponse.json({ ok: false, error: "Not enrolled in this course" }, { status: 403 });
  if (!access.canView) return NextResponse.json({ ok: false, error: "This lesson is locked" }, { status: 403 });

  const status = await setLessonStatus(user, access.lesson, "partial", dwellDelta);

  const db = await getDb();
  const row = db.progress.find((p) => p.userId === user.id && p.lessonId === access.lesson.id);
  const dwellSeconds = row?.dwellSeconds ?? 0;
  const requirements = status === "complete" ? null : await getCompletionRequirements(user, access.lesson, dwellSeconds);

  return NextResponse.json({
    ok: true,
    status,
    dwellSeconds,
    dwellRequired: db.settings.learning.lessonDwellTimeSeconds,
    canComplete: status !== "complete" && !!requirements?.allMet,
    missing: requirements?.missing ?? [],
  });
}
