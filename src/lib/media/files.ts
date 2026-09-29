import "server-only";
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { PROTECTED_VIDEO_DIR, PROTECTED_VIDEO_PREFIX, parseUploadRequestPath, sameMediaPath, type UploadRequestPath } from "./paths";
import { MediaSigningUnavailableError, verifyMediaToken, type MediaTokenFailure, type MediaTokenResult } from "./token";

/**
 * Serving uploaded files (`/uploads/[...path]`): mapping a URL to a file and
 * deciding whether it is a protected lesson video.
 *
 * Protection follows where the file really is, not how the URL spells it.
 * The file is resolved with `fs.realpath` (symlinks, NTFS short names and
 * letter-case variants all collapse onto the real file) and is protected
 * when that real path lies inside the real video directory, compared
 * case-insensitively like NTFS and APFS compare names. The token must then
 * be valid for the real file, so a URL spelled differently cannot reuse a
 * token issued for something else. URLs whose first segment spells the
 * video directory in any case are checked before the filesystem is touched,
 * so without a token nobody can probe which videos exist. If the video
 * directory cannot be resolved (other than "not created yet"), every file
 * counts as protected: the check fails closed.
 */

export const UPLOAD_MIME_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export interface LocatedUpload {
  /** Real path of the file on disk (what is streamed). */
  filePath: string;
  stat: Stats;
  /** Lower-case extension of the real file name, e.g. ".mp4". */
  ext: string;
  /** The real file lies in the protected video directory (or that directory could not be resolved). */
  inVideoDir: boolean;
  /** Canonical media path of the real file (`/uploads/videos/<name>`), when it could be derived. */
  canonicalPath: string | null;
}

const FAIL_CLOSED = Symbol("fail-closed");

function foldCase(value: string): string {
  return value.toUpperCase().toLowerCase();
}

/** Real location of the video directory, where it would be when it does not exist yet, or FAIL_CLOSED. */
async function realVideoDir(root: string): Promise<string | typeof FAIL_CLOSED> {
  try {
    return await fs.realpath(path.join(/* turbopackIgnore: true */ root, PROTECTED_VIDEO_DIR));
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR") return FAIL_CLOSED;
    try {
      return path.join(/* turbopackIgnore: true */ await fs.realpath(root), PROTECTED_VIDEO_DIR);
    } catch {
      return FAIL_CLOSED;
    }
  }
}

/**
 * Find the file an upload URL names. Returns null when it does not exist, is
 * not a regular file, or the name escapes the upload directory.
 */
export async function locateUpload(root: string, request: UploadRequestPath): Promise<LocatedUpload | null> {
  const base = path.resolve(/* turbopackIgnore: true */ root);
  const lexical = path.join(/* turbopackIgnore: true */ base, ...request.name.split("/"));
  if (!lexical.startsWith(base + path.sep)) return null;

  let filePath: string;
  let stat: Stats;
  try {
    filePath = await fs.realpath(lexical);
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  let inVideoDir = false;
  let canonicalPath: string | null = null;
  const videoDir = await realVideoDir(base);
  if (videoDir === FAIL_CLOSED) {
    inVideoDir = true;
  } else {
    // path.relative compares case-insensitively on Windows; the folded prefix test covers other
    // case-insensitive filesystems (and treats a same-name sibling on Linux as protected too).
    const rel = path.relative(videoDir, filePath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      inVideoDir = true;
      canonicalPath = `${PROTECTED_VIDEO_PREFIX}${rel.split(path.sep).join("/")}`;
    } else if (foldCase(filePath).startsWith(foldCase(videoDir) + path.sep)) {
      inVideoDir = true;
    }
  }
  return { filePath, stat, ext: path.extname(filePath).toLowerCase(), inVideoDir, canonicalPath };
}

export type UploadAccess =
  | {
      ok: true;
      file: LocatedUpload;
      /** A protected video whose token was verified for this viewer. */
      signed: boolean;
      /** The URL or the real file is in the video directory (never publicly cacheable). */
      videoDir: boolean;
    }
  | { ok: false; status: 404 }
  | { ok: false; status: 403; reason: MediaTokenFailure }
  /** Protected videos cannot be verified without a usable APP_SECRET. */
  | { ok: false; status: 503 };

export interface UploadAccessOptions {
  /** Absolute upload directory. */
  root: string;
  /** The `?t=` token of the request, if any. */
  token: string | null;
  /** Whether `settings.video.protectUploads` is on (only read for videos). */
  protectUploads: () => Promise<boolean>;
  /** Signing subject of the viewer: user id or "guest" (only read for protected videos). */
  subject: () => Promise<string>;
  /** Unix seconds (tests). */
  now?: number;
  /** Signing secret (tests); defaults to APP_SECRET. */
  secret?: string;
}

/** Decide how `/uploads/<parts…>` is answered: 404, 403 (token), 503 (no signing key) or the file. */
export async function resolveUploadAccess(parts: readonly string[], options: UploadAccessOptions): Promise<UploadAccess> {
  const request = parseUploadRequestPath(parts);
  if (!request) return { ok: false, status: 404 };

  let protection: boolean | null = null;
  const protectionOn = async () => (protection ??= await options.protectUploads());
  let subject: string | null = null;
  const verify = async (mediaPath: string): Promise<UploadAccess | null> => {
    subject ??= await options.subject();
    let result: MediaTokenResult;
    try {
      result = verifyMediaToken(mediaPath, subject, options.token, options.now, options.secret);
    } catch (err) {
      if (err instanceof MediaSigningUnavailableError) return { ok: false, status: 503 };
      throw err;
    }
    return result.ok ? null : { ok: false, status: 403, reason: result.reason };
  };

  // Video-directory URLs are verified before the filesystem is touched (no existence oracle).
  if (request.inVideoDir && (await protectionOn())) {
    const denied = await verify(request.path);
    if (denied) return denied;
  }

  const file = await locateUpload(options.root, request);
  if (!file) return { ok: false, status: 404 };

  if (file.inVideoDir && (await protectionOn())) {
    // The token has to cover the file that is really served.
    const target = file.canonicalPath ?? request.path;
    if (!request.inVideoDir || !sameMediaPath(target, request.path)) {
      const denied = await verify(target);
      if (denied) return denied;
    }
  }

  const videoDir = request.inVideoDir || file.inVideoDir;
  return { ok: true, file, signed: videoDir && (await protectionOn()), videoDir };
}

/**
 * Response headers for a served upload. Signed videos are personal and short
 * lived (`private, no-store`); anything in the video directory served while
 * protection is off stays out of shared caches so switching protection on
 * takes effect; only other uploads are publicly cacheable.
 */
export function uploadResponseHeaders(file: Pick<LocatedUpload, "ext" | "stat">, access: { signed: boolean; videoDir: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": UPLOAD_MIME_TYPES[file.ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": file.stat.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (access.signed) {
    headers["Cache-Control"] = "private, no-store";
    headers["Content-Disposition"] = "inline";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
    headers["X-Robots-Tag"] = "noindex, nofollow";
  } else if (access.videoDir) {
    headers["Cache-Control"] = "private, max-age=3600";
    headers["X-Robots-Tag"] = "noindex, nofollow";
  } else {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  // SVGs can carry <script>; opened directly (or framed) they would run on this origin. Sandbox them.
  if (file.ext === ".svg") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return headers;
}
