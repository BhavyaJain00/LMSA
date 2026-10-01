import { NextResponse, after, type NextRequest } from "next/server";
import { completeUploadSession, getOwnedSession, offloadCompletedUpload } from "@/lib/media/resumable";
import { onSourceUploaded } from "@/lib/media/transcode/queue";
import { authorizeUploadRequest, errorResponse, NO_STORE } from "@/lib/media/upload-http";
import { isRemoteStorage } from "@/lib/storage";

/**
 * POST /api/uploads/<id>/complete — finish an upload whose bytes have all
 * arrived. Answers `{ ok, url, name, size, type }` like `POST /api/upload`.
 * Calling it again for a finished upload returns the same URL.
 *
 * The file is moved into the upload folder right away (it is served from
 * there at once); with S3-compatible storage it is copied to the bucket
 * after the response. A finished video also starts the HLS converter for
 * saved lesson blocks that play it (see `onSourceUploaded`).
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return auth.response;
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    const done = await completeUploadSession(session);
    const video = session.kind === "video";
    if (isRemoteStorage() || video) {
      after(async () => {
        // Copy to the bucket first, so a conversion reads the file from where it stays.
        if (isRemoteStorage()) await offloadCompletedUpload(done.key, done.type);
        if (video) await onSourceUploaded(done.key);
      });
    }
    return NextResponse.json({ ok: true, url: done.url, name: done.name, size: done.size, type: done.type }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
