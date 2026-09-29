import { NextResponse, type NextRequest } from "next/server";
import type { LessonBlock, VideoWatch } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { mutate } from "@/lib/db/store";
import { getLessonAccess } from "@/lib/data/lessons";
import { canPlayLessonMedia, siteOrigins } from "@/lib/media/access";
import { readLimitedText } from "@/lib/media/body";
import { applyHeartbeat } from "@/lib/media/heartbeat";
import { sameMediaSource, stripMediaToken } from "@/lib/media/paths";
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

const MAX_BODY_BYTES = 16 * 1024;
const ID = /^[\w-]{1,64}$/;

/**
 * Heartbeats arrive every ~10 s while playing, plus one on pause, tab hide
 * and end. The per-video rule leaves room for bursts of pauses and seeks; the
 * per-user rule bounds writes across videos.
 */
const PER_VIDEO_RULE = { limit: 30, windowMs: 60_000 };
const PER_USER_RULE = { limit: 90, windowMs: 60_000 };
const g = globalThis as unknown as { __llVideoProgressLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llVideoProgressLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function tooMany(retryAfterMs: number) {
  return NextResponse.json(
    { ok: false, error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );
}

/**
 * Heartbeat endpoint for the custom video player. Records watch time, resume
 * position, completion and retention bins (which 1% slices of the video were
 * played) for enrolled learners. Every reported number is bounded by the
 * real time that passed since the previous heartbeat (see
 * `src/lib/media/heartbeat.ts`). Accepts JSON or a text/plain beacon body of
 * at most 16 KB.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const userLimit = limiter.hit(`video-progress:user:${user.id}`, PER_USER_RULE);
  if (!userLimit.ok) return tooMany(userLimit.retryAfterMs);

  const read = await readLimitedText(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json({ ok: false, error: read.status === 413 ? "Body too large" : "Invalid body" }, { status: read.status });
  }
  let body: Body;
  try {
    const parsed: unknown = JSON.parse(read.text);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  const blockId = typeof body.blockId === "string" ? body.blockId : "";
  if (!ID.test(lessonId) || !ID.test(blockId)) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  const videoLimit = limiter.hit(`video-progress:video:${user.id}:${lessonId}:${blockId}`, PER_VIDEO_RULE);
  if (!videoLimit.ok) return tooMany(videoLimit.retryAfterMs);

  const access = await getLessonAccess(user, lessonId);
  if (!access) return NextResponse.json({ ok: false, error: "Lesson not found" }, { status: 404 });
  // Same rule as the lesson page (tracking = enrolled): previews and managers are not recorded.
  if (!access.enrolled) return NextResponse.json({ ok: false, error: "Not enrolled in this course" }, { status: 403 });
  if (!canPlayLessonMedia(access)) return NextResponse.json({ ok: false, error: "You don't have access to this lesson." }, { status: 403 });
  const lesson = access.lesson;
  const block = lesson.blocks.find((b): b is Extract<LessonBlock, { type: "video" }> => b.type === "video" && b.id === blockId);
  if (!block) return NextResponse.json({ ok: false, error: "Video not found in this lesson" }, { status: 404 });

  // Only ever store one of the block's own sources (never a client-chosen string or a token).
  const reported = typeof body.source === "string" ? body.source.slice(0, 2000) : "";
  const origins = siteOrigins(req.nextUrl.origin);
  const candidates = [block.src, ...(block.sources ?? []).map((s) => s.src)].filter(Boolean);
  const source = stripMediaToken((reported && candidates.find((c) => sameMediaSource(c, reported, origins))) || block.src);

  const input = {
    position: num(body.position),
    watchedDelta: num(body.watchedDelta),
    maxPosition: num(body.maxPosition),
    duration: num(body.duration),
    ended: body.ended === true,
    ranges: body.ranges,
  };
  let completed = false;

  await mutate((d) => {
    const nowMs = Date.now();
    let row: VideoWatch | undefined = d.videoWatches.find((w) => w.userId === user.id && w.lessonId === lesson.id && w.blockId === blockId);
    const isNew = !row;
    if (!row) {
      row = {
        id: uid("vw"),
        userId: user.id,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        blockId,
        source,
        watchSeconds: 0,
        lastPositionSeconds: 0,
        maxPositionSeconds: 0,
        durationSeconds: 0,
        completed: false,
        updatedAt: new Date(nowMs).toISOString(),
      };
      d.videoWatches.push(row);
    }
    row.source = source;
    const outcome = applyHeartbeat(row, input, {
      nowMs,
      isNew,
      blockDuration: block.duration,
      thresholdPercent: access.settings.learning.videoCompletionThreshold,
      preventSkipping: access.settings.learning.preventSkippingVideos,
    });
    completed = outcome.completed;
  });

  await logActivity(user.id, "lesson_view", lesson.id);
  return NextResponse.json({ ok: true, completed });
}
