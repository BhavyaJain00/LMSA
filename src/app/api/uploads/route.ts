import { NextResponse, after, type NextRequest } from "next/server";
import { readLimitedText } from "@/lib/media/body";
import { createUploadSession, maybeCleanupStaleUploads, sessionView } from "@/lib/media/resumable";
import { authorizeUploadRequest, errorResponse, jsonError, offsetHeaders } from "@/lib/media/upload-http";

/**
 * POST /api/uploads — start a resumable upload.
 *
 * Body (JSON): `{ kind: "video" | "image" | "document" | "auto", fileName, size, mimeType }`.
 * Answers 201 with `{ ok, id, chunkSize, offset: 0, url: null }` and a
 * `Location` header naming the upload. Send the bytes with
 * `PATCH /api/uploads/<id>` (see `src/lib/media/resumable-shared.ts`).
 *
 * The declared name, size and type are validated against the uploader's
 * role and limits before anything is stored; each account may have a few
 * unfinished uploads at a time. Uploads idle for a day are expired here too
 * (at most hourly, after the response) besides the media cron.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: NextRequest) {
  const auth = await authorizeUploadRequest(req, "create");
  if ("response" in auth) return auth.response;

  const body = await readLimitedText(req, MAX_BODY_BYTES);
  if (!body.ok) return jsonError(body.status, "Invalid upload request.");
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    input = parsed as Record<string, unknown>;
  } catch {
    return jsonError(400, "Invalid upload request.");
  }

  after(() => maybeCleanupStaleUploads());
  try {
    const session = await createUploadSession(auth.user, { kind: input.kind, fileName: input.fileName, size: input.size, mimeType: input.mimeType });
    return NextResponse.json(
      { ok: true, ...sessionView(session) },
      { status: 201, headers: { ...offsetHeaders(0, session.size), Location: `/api/uploads/${session.id}` } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
