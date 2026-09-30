import { NextResponse, after, type NextRequest } from "next/server";
import { completeUploadSession, getOwnedSession, offloadCompletedUpload } from "@/lib/media/resumable";
import { authorizeUploadRequest, errorResponse, NO_STORE } from "@/lib/media/upload-http";
import { isRemoteStorage } from "@/lib/storage";

/**
 * POST /api/uploads/<id>/complete — finish an upload whose bytes have all
 * arrived. Answers `{ ok, url, name, size, type }` like `POST /api/upload`.
 * Calling it again for a finished upload returns the same URL.
 *
 * The file is moved into the upload folder right away (it is served from
 * there at once); with S3-compatible storage it is copied to the bucket
 * after the response.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return auth.response;
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    const done = await completeUploadSession(session);
    if (isRemoteStorage()) after(() => offloadCompletedUpload(done.key, done.type));
    return NextResponse.json({ ok: true, url: done.url, name: done.name, size: done.size, type: done.type }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
