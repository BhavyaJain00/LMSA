import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { createReadStream, type Stats } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { siteConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canonicalMediaPath, isProtectedVideoPath, MEDIA_TOKEN_PARAM } from "@/lib/media/paths";
import { mediaSubject, verifyMediaToken, type MediaTokenFailure } from "@/lib/media/token";

const MIME: Record<string, string> = {
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

const FAILURE_MESSAGES: Record<MediaTokenFailure, string> = {
  missing: "This video requires a signed link.",
  malformed: "This video link is invalid.",
  expired: "This video link has expired.",
  invalid: "This video link is not valid for your account.",
};

interface Resolved {
  filePath: string;
  stat: Stats;
  ext: string;
  /** The response is for a protected video that passed token verification. */
  signed: boolean;
}

type Resolution = { ok: true; file: Resolved } | { ok: false; response: NextResponse };

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Map the URL to a file inside the upload directory and, for protected
 * lesson videos, verify the signed token against the current session.
 */
async function resolve(req: NextRequest, parts: string[]): Promise<Resolution> {
  if (!parts.length) return { ok: false, response: notFound() };
  const name = parts.join("/");
  if (name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return { ok: false, response: notFound() };
  const mediaPath = canonicalMediaPath(`/uploads/${parts.map((p) => encodeURIComponent(p)).join("/")}`);
  if (!mediaPath) return { ok: false, response: notFound() };

  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir);
  const filePath = path.join(/* turbopackIgnore: true */ root, name);
  if (!filePath.startsWith(root + path.sep)) return { ok: false, response: notFound() };

  let signed = false;
  if (isProtectedVideoPath(mediaPath)) {
    const settings = await getSettings();
    if (settings.video.protectUploads) {
      const user = await getCurrentUser();
      const token = req.nextUrl.searchParams.get(MEDIA_TOKEN_PARAM);
      const result = verifyMediaToken(mediaPath, mediaSubject(user), token);
      if (!result.ok) {
        return {
          ok: false,
          response: new NextResponse(FAILURE_MESSAGES[result.reason], {
            status: 403,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "private, no-store",
              "X-Media-Token": result.reason,
              "X-Robots-Tag": "noindex",
            },
          }),
        };
      }
      signed = true;
    }
  }

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { ok: false, response: notFound() };
  }
  if (!stat.isFile()) return { ok: false, response: notFound() };
  return { ok: true, file: { filePath, stat, ext: path.extname(filePath).toLowerCase(), signed } };
}

function baseHeaders(file: Resolved, videoDir: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": MIME[file.ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": file.stat.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (file.signed) {
    // Signed responses are personal and short-lived: never store them in shared or browser caches.
    headers["Cache-Control"] = "private, no-store";
    headers["Content-Disposition"] = "inline";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
    headers["X-Robots-Tag"] = "noindex, nofollow";
  } else if (videoDir) {
    // Protection is off: still keep lesson videos out of shared caches so turning it on takes effect.
    headers["Cache-Control"] = "private, max-age=3600";
  } else {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  // SVGs can carry <script>; opened directly (or framed) they would run on this origin. Sandbox them.
  if (file.ext === ".svg") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return headers;
}

/** Parse a single `bytes=` range. Returns null when absent/unsupported, "invalid" when unsatisfiable. */
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (!m[1] && m[2]) {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = m[1] ? Number(m[1]) : 0;
    end = m[2] ? Number(m[2]) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

async function serve(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">, head: boolean): Promise<NextResponse> {
  const { path: parts } = await ctx.params;
  const resolution = await resolve(req, parts);
  if (!resolution.ok) return resolution.response;
  const file = resolution.file;
  const size = file.stat.size;
  const headers = baseHeaders(file, isProtectedVideoPath(`/uploads/${parts.join("/")}`));

  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    const length = range.end - range.start + 1;
    const rangeHeaders = { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(length) };
    if (head) return new NextResponse(null, { status: 206, headers: rangeHeaders });
    const stream = Readable.toWeb(createReadStream(file.filePath, { start: range.start, end: range.end })) as ReadableStream;
    return new NextResponse(stream, { status: 206, headers: rangeHeaders });
  }

  const fullHeaders = { ...headers, "Content-Length": String(size) };
  if (head) return new NextResponse(null, { status: 200, headers: fullHeaders });
  const stream = Readable.toWeb(createReadStream(file.filePath)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: fullHeaders });
}

/**
 * Serves uploaded files from the upload directory with HTTP Range support so
 * the custom video player can seek inside self-hosted videos.
 *
 * Lesson videos live under `/uploads/videos/`. While
 * `settings.video.protectUploads` is on they require a signed, expiring
 * `?t=` token bound to the viewer's session (see `src/lib/media`). Other
 * uploads, and videos uploaded before protection existed, are served as is.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, false);
}

export async function HEAD(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, true);
}
