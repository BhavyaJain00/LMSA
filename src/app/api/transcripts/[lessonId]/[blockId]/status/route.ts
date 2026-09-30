import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { blockTranscript, findVideoBlock } from "@/lib/transcripts/data";
import { recoverInterruptedTranscripts, transcriptionJobState } from "@/lib/transcripts/auto";
import { toEditorTranscript } from "@/lib/transcripts/editor-shared";

/**
 * GET /api/transcripts/<lessonId>/<blockId>/status
 *
 * Generation state for the transcript editor, which polls it while an
 * automatic transcript is queued or running: `{ ok, job, transcript }`.
 * `job` is null when nothing is running; `transcript` carries the stored
 * cues (so the editor can load the result as soon as the job finishes).
 * Course managers only.
 */

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(_req: Request, ctx: RouteContext<"/api/transcripts/[lessonId]/[blockId]/status">) {
  const { lessonId, blockId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to see this transcript." }, { status: 401, headers: HEADERS });

  await recoverInterruptedTranscripts();
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  const course = lesson ? db.courses.find((c) => c.id === lesson.courseId) : null;
  if (!lesson || !course) return NextResponse.json({ ok: false, error: "This lesson no longer exists." }, { status: 404, headers: HEADERS });
  if (!canManageCourse(user, course)) return NextResponse.json({ ok: false, error: "You do not have access to this lesson's transcripts." }, { status: 403, headers: HEADERS });
  const block = findVideoBlock(lesson, blockId);
  if (!block) return NextResponse.json({ ok: false, error: "This video is no longer part of the lesson." }, { status: 404, headers: HEADERS });

  const transcript = blockTranscript(db, block);
  return NextResponse.json(
    { ok: true, job: transcriptionJobState(lesson.id, block.id), transcript: transcript ? toEditorTranscript(transcript) : null },
    { headers: HEADERS },
  );
}
