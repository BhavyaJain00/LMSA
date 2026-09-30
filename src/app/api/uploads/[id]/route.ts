import { NextResponse, type NextRequest } from "next/server";
import { abortUploadSession, appendChunk, currentOffset, getOwnedSession, sessionView } from "@/lib/media/resumable";
import { authorizeUploadRequest, errorResponse, offsetHeaders } from "@/lib/media/upload-http";

/**
 * One resumable upload.
 *
 *   HEAD   → `Upload-Offset` (bytes stored so far) and `Upload-Length`
 *   GET    → the same as JSON, plus status and the final URL once complete
 *   PATCH  → append the raw request body at `Upload-Offset` (at most 64 MB
 *            per request); answers the new offset. A mismatched offset gets
 *            409 with the offset to resume from.
 *   DELETE → cancel the upload and delete what was stored
 *
 * Only the account that started an upload can see or change it.
 */

export const dynamic = "force-dynamic";

export async function HEAD(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return new NextResponse(null, { status: auth.response.status, headers: auth.response.headers });
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    const offset = await currentOffset(session);
    const status = session.status === "aborted" ? 410 : 200;
    return new NextResponse(null, { status, headers: { ...offsetHeaders(offset, session.size), "Upload-Status": session.status } });
  } catch (err) {
    const res = errorResponse(err);
    return new NextResponse(null, { status: res.status, headers: res.headers });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return auth.response;
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    const offset = await currentOffset(session);
    return NextResponse.json({ ok: true, ...sessionView(session, offset) }, { headers: offsetHeaders(offset, session.size) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return auth.response;
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    const offset = await appendChunk(session, req);
    return NextResponse.json({ ok: true, offset, size: session.size, done: offset >= session.size }, { headers: offsetHeaders(offset, session.size) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const auth = await authorizeUploadRequest(req, "transfer");
  if ("response" in auth) return auth.response;
  try {
    const session = await getOwnedSession(auth.user, (await ctx.params).id);
    await abortUploadSession(session);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
