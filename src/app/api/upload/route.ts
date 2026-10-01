import { NextResponse, after, type NextRequest } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { receiveUpload } from "@/lib/media/upload";
import { offloadCompletedUpload } from "@/lib/media/resumable";
import { onSourceUploaded } from "@/lib/media/transcode/queue";
import { isRemoteStorage, storageKeyFromUrl, uploadRoot } from "@/lib/storage";

/**
 * Single-request upload endpoint (multipart/form-data with a `file` field and
 * optional `kind`), used for small files. Large files and every video go
 * through the resumable protocol at `/api/uploads`.
 *
 * Staff may upload anything supported; students may upload documents/images
 * (assignment submissions, avatars). Files are stored under the upload dir
 * and served from /uploads/<name>. Videos go to /uploads/videos/<name>, where
 * they can be protected with signed, expiring URLs (Settings → Video).
 *
 * The body is never buffered: the Content-Length is checked against the
 * uploader's limit before reading, and the multipart stream is written to a
 * temporary file as it arrives (see `receiveUpload`). With S3-compatible
 * storage the finished file is copied to the bucket after the response.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const result = await receiveUpload(req, {
    root: uploadRoot(),
    staff: isStaff(user),
    maxVideoBytes: siteConfig.maxUploadBytes,
    maxAssetBytes: siteConfig.maxAssetBytes,
  });
  if (result.body.ok) {
    const key = storageKeyFromUrl(result.body.url);
    const type = result.body.type;
    const video = type.startsWith("video/");
    if (key && (isRemoteStorage() || video)) {
      after(async () => {
        if (isRemoteStorage()) await offloadCompletedUpload(key, type);
        if (video) await onSourceUploaded(key);
      });
    }
  }
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
