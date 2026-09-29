import { NextResponse, type NextRequest } from "next/server";
import type { LessonBlock, VideoWatch } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { getLessonAccess } from "@/lib/data/lessons";
import { canPlayLessonMedia } from "@/lib/media/access";
import { stripMediaToken } from "@/lib/media/paths";
import { applyRangesToBins, capRanges, sanitizeRanges, totalLength } from "@/lib/media/retention";
import { uid } from "@/lib/utils";
import { logActivity } from "@/lib/services/activity";

interface Body {
  lessonId?: unknown;
  blockId?: unknown;
  source?: unknown;
  position?: unknown;
  watchedDelta?: unknown;
  maxPosition?: unknown;
  duration?: unknown;
  ended?: unknown;
  /** Ranges [start, end) in seconds played since the previous heartbeat (retention analytics). */
  ranges?: unknown;
}

/** Longest watch time one heartbeat may add (heartbeats are sent every ~10 s). */
const MAX_DELTA_SECONDS = 120;
/** Playback can run at up to 2× speed, plus slack for timer jitter. */
const MAX_RATE = 2;
const RANGE_SLACK_SECONDS = 3;
const MAX_BODY_BYTES = 16 * 1024;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Heartbeat endpoint for the custom video player. Records watch time, resume
 * position, completion (≥ threshold of the video watched) and retention bins
 * (which 1% slices of the video were played). Accepts JSON or a text/plain
 * beacon body.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "Body too large" }, { status: 413 });
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  const blockId = typeof body.blockId === "string" ? body.blockId : "";
  if (!lessonId || !blockId) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  const access = await getLessonAccess(user, lessonId);
  if (!access) return NextResponse.json({ ok: false, error: "Lesson not found" }, { status: 404 });
  if (!canPlayLessonMedia(access)) return NextResponse.json({ ok: false, error: "You don't have access to this lesson." }, { status: 403 });
  const lesson = access.lesson;
  const block = lesson.blocks.find((b): b is Extract<LessonBlock, { type: "video" }> => b.type === "video" && b.id === blockId);
  if (!block) return NextResponse.json({ ok: false, error: "Video not found in this lesson" }, { status: 404 });

  const threshold = access.settings.learning.videoCompletionThreshold / 100;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const position = num(body.position);
  const maxPosition = num(body.maxPosition);
  const reportedDuration = num(body.duration);
  const watchedDelta = num(body.watchedDelta);
  const ended = body.ended === true;
  const source = typeof body.source === "string" ? stripMediaToken(body.source).slice(0, 2000) : "";
  let completed = false;

  await mutate((d) => {
    let row: VideoWatch | undefined = d.videoWatches.find((w) => w.userId === user.id && w.lessonId === lesson.id && w.blockId === blockId);
    const isNew = !row;
    if (!row) {
      row = {
        id: uid("vw"),
        userId: user.id,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        blockId,
        source: source || stripMediaToken(block.src),
        watchSeconds: 0,
        lastPositionSeconds: 0,
        maxPositionSeconds: 0,
        durationSeconds: 0,
        completed: false,
        updatedAt: now,
      };
      d.videoWatches.push(row);
    }
    const sinceLast = isNew ? MAX_DELTA_SECONDS : Math.max(0, (nowMs - new Date(row.updatedAt).getTime()) / 1000);
    const delta = watchedDelta !== null ? Math.max(0, Math.min(watchedDelta, MAX_DELTA_SECONDS)) : 0;
    row.watchSeconds += delta;
    if (position !== null) row.lastPositionSeconds = Math.max(0, position);
    if (maxPosition !== null) row.maxPositionSeconds = Math.max(row.maxPositionSeconds, maxPosition);
    if (reportedDuration !== null && reportedDuration > 0) row.durationSeconds = reportedDuration;
    if (source) row.source = source;

    // Retention: one viewing pass per covered bin, never more than the time that could really have been played.
    const duration = row.durationSeconds || block.duration || 0;
    if (duration > 0 && body.ranges !== undefined) {
      const ranges = sanitizeRanges(body.ranges, duration);
      const allowed = Math.min(delta * 1.25 + RANGE_SLACK_SECONDS, sinceLast * MAX_RATE + RANGE_SLACK_SECONDS, MAX_DELTA_SECONDS * MAX_RATE);
      const capped = totalLength(ranges) > allowed ? capRanges(ranges, allowed) : ranges;
      if (capped.length) row.bins = applyRangesToBins(row.bins, capped, duration);
    }

    if (!row.completed && row.durationSeconds > 0) {
      const reached = Math.max(row.maxPositionSeconds, ended ? row.durationSeconds : 0) / row.durationSeconds;
      const watchedRatio = row.watchSeconds / row.durationSeconds;
      if (reached >= threshold || watchedRatio >= threshold || ended) row.completed = true;
    }
    completed = row.completed;
    row.updatedAt = now;
  });

  await logActivity(user.id, "lesson_view", lesson.id);
  return NextResponse.json({ ok: true, completed });
}
