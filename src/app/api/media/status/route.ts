import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getBlockMediaStatus } from "@/lib/media/transcode/status";

/**
 * GET /api/media/status?lessonId=<id>&blockId=<id>
 *
 * Conversion state of a lesson video block for the lesson editor, which polls
 * it while a video is being converted: `{ ok, status }` with the block's
 * `transcode` state, the latest job (progress, queue position, error),
 * ffmpeg availability and the transcript editor link. Course managers only.
 *
 * Polling also starts work lazily: a saved upload that was never converted
 * is queued, and a queue left idle by a restart is resumed.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const blockId = (params.get("blockId") ?? "").trim();
  const lessonId = (params.get("lessonId") ?? "").trim() || null;
  if (!blockId) return NextResponse.json({ ok: false, error: "Missing block." }, { status: 400, headers: NO_STORE });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to see this video's status." }, { status: 401, headers: NO_STORE });

  const result = await getBlockMediaStatus(user, lessonId, blockId, { autoQueue: true });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, status: result.status }, { headers: NO_STORE });
}
