import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isTranscriptVisible, readTranscriptFor, toTranscriptView } from "@/lib/transcripts/data";
import { TRANSCRIPT_CONTENT_TYPES, serializeTranscript, transcriptFileName, type TranscriptFormat } from "@/lib/transcripts/format";

/**
 * GET /api/transcripts/<lessonId>/<blockId>[?format=vtt|srt|txt]
 *
 * The transcript of a lesson video for anyone who may play that video
 * (same rule as the video itself: enrolled learners, free previews,
 * managers). Without `format` it answers `{ ok, transcript }` for the
 * transcript panel and caption track (`transcript` is null when the video
 * has none yet). With `format` it returns a download. Course managers also
 * get transcripts that are still being generated (empty cues) so the lesson
 * page can say so.
 *
 * Responses are private and revalidated with an ETag, so revisiting a
 * lesson does not download an unchanged transcript again.
 */

export const dynamic = "force-dynamic";

const FORMATS: TranscriptFormat[] = ["vtt", "srt", "txt"];
const BASE_HEADERS = { "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...BASE_HEADERS, "Cache-Control": "private, no-store" } });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/transcripts/[lessonId]/[blockId]">) {
  const { lessonId, blockId } = await ctx.params;
  const formatParam = req.nextUrl.searchParams.get("format");
  const format = formatParam ? (FORMATS.find((f) => f === formatParam.toLowerCase()) ?? null) : null;
  if (formatParam && !format) return json({ ok: false, error: "Choose vtt, srt or txt." }, 400);

  const user = await getCurrentUser();
  const result = await readTranscriptFor(user, lessonId, blockId);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  const { transcript, access } = result;
  const visible = isTranscriptVisible(transcript) ? transcript : null;

  if (format) {
    if (!visible) return json({ ok: false, error: "This video has no transcript yet." }, 404);
    const body = serializeTranscript(visible.cues, format, { language: visible.language, title: access.lesson.title });
    const fileName = transcriptFileName(access.lesson.title, format);
    return new NextResponse(body, {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": TRANSCRIPT_CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const pending = !visible && access.manager && transcript?.status === "processing";
  const etag = `W/"${visible ? `${visible.id}-${visible.updatedAt}` : pending ? "pending" : "none"}"`;
  const headers = { ...BASE_HEADERS, "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie" };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json({ ok: true, transcript: visible ? toTranscriptView(visible) : null, pending }, { headers });
}
