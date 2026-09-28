import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { findById, getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { logActivity } from "@/lib/services/activity";

interface Body {
  lessonId: string;
  blockId: string;
  source: string;
  position: number;
  watchedDelta: number;
  maxPosition: number;
  duration: number;
  ended?: boolean;
}

/**
 * Heartbeat endpoint for the custom video player. Records watch time, resume
 * position and completion (≥ threshold of the video watched).
 * Accepts JSON or a text/plain beacon body.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    const text = await req.text();
    body = JSON.parse(text) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body.lessonId || !body.blockId) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  const lesson = await findById("lessons", body.lessonId);
  if (!lesson) return NextResponse.json({ ok: false, error: "Lesson not found" }, { status: 404 });

  const db = await getDb();
  const threshold = db.settings.learning.videoCompletionThreshold / 100;
  const now = new Date().toISOString();
  let completed = false;

  await mutate((d) => {
    let row = d.videoWatches.find((w) => w.userId === user.id && w.lessonId === lesson.id && w.blockId === body.blockId);
    if (!row) {
      row = {
        id: uid("vw"),
        userId: user.id,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        blockId: body.blockId,
        source: body.source,
        watchSeconds: 0,
        lastPositionSeconds: 0,
        maxPositionSeconds: 0,
        durationSeconds: 0,
        completed: false,
        updatedAt: now,
      };
      d.videoWatches.push(row);
    }
    const delta = Number.isFinite(body.watchedDelta) ? Math.max(0, Math.min(body.watchedDelta, 120)) : 0;
    row.watchSeconds += delta;
    row.lastPositionSeconds = Number.isFinite(body.position) ? Math.max(0, body.position) : row.lastPositionSeconds;
    row.maxPositionSeconds = Math.max(row.maxPositionSeconds, Number.isFinite(body.maxPosition) ? body.maxPosition : 0);
    if (Number.isFinite(body.duration) && body.duration > 0) row.durationSeconds = body.duration;
    row.source = body.source || row.source;
    if (!row.completed && row.durationSeconds > 0) {
      const reached = Math.max(row.maxPositionSeconds, body.ended ? row.durationSeconds : 0) / row.durationSeconds;
      const watchedRatio = row.watchSeconds / row.durationSeconds;
      if (reached >= threshold || watchedRatio >= threshold || body.ended) row.completed = true;
    }
    completed = row.completed;
    row.updatedAt = now;
  });

  await logActivity(user.id, "lesson_view", lesson.id);
  return NextResponse.json({ ok: true, completed });
}
