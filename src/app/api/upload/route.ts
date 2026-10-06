import { NextResponse, after, type NextRequest } from "next/server";
import { isStaff } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { receiveUpload } from "@/lib/media/upload";
import { offloadCompletedUpload } from "@/lib/media/resumable";
import { parseContentLength } from "@/lib/media/resumable-shared";
import { admitSingleUpload } from "@/lib/media/upload-quota";
import { authorizeUploadRequest, jsonError } from "@/lib/media/upload-http";
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
 * Like the resumable routes, requests must come from this site and are rate
 * limited per account; the disk must have room and learners are held to a
 * daily byte budget (`upload-quota.ts`), reserved by the Content-Length
 * before the body is read.
 *
 * The body is never buffered: the Content-Length is checked against the
 * uploader's limit before reading, and the multipart stream is written to a
 * temporary file as it arrives (see `receiveUpload`). With S3-compatible
 * storage the finished file is copied to the bucket after the response.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeUploadRequest(req, "single");
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const declared = parseContentLength(req.headers.get("content-length"));
  const staff = isStaff(user);
  const roleLimit = staff ? Math.max(siteConfig.maxUploadBytes, siteConfig.maxAssetBytes) : siteConfig.maxAssetBytes;
  // A missing or oversized length is refused by `receiveUpload` itself; reserve what may really be stored.
  const admission = await admitSingleUpload(user, Math.min(declared ?? 0, roleLimit));
  if (!admission.ok) return jsonError(admission.status, admission.error, null, {}, admission.code);

  let stored = 0;
  try {
    const result = await receiveUpload(req, {
      root: uploadRoot(),
      staff,
      maxVideoBytes: siteConfig.maxUploadBytes,
      maxAssetBytes: siteConfig.maxAssetBytes,
    });
    if (result.body.ok) {
      stored = result.body.size;
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
  } finally {
    admission.reservation.settle(stored);
  }
}
