import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { receiveUpload } from "@/lib/media/upload";

/**
 * File upload endpoint (multipart/form-data with a `file` field and optional `kind`).
 * Staff may upload anything supported; students may upload documents/images
 * (assignment submissions, avatars). Files are stored under the upload dir
 * and served from /uploads/<name>. Videos go to /uploads/videos/<name>, where
 * they can be protected with signed, expiring URLs (Settings → Video).
 *
 * The body is never buffered: the Content-Length is checked against the
 * uploader's limit before reading, and the multipart stream is written to a
 * temporary file as it arrives (see `receiveUpload`).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const result = await receiveUpload(req, {
    root: path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir),
    staff: isStaff(user),
    maxVideoBytes: siteConfig.maxUploadBytes,
    maxAssetBytes: siteConfig.maxAssetBytes,
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
