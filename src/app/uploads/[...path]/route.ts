import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { siteConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { MEDIA_TOKEN_PARAM } from "@/lib/media/paths";
import { resolveUploadAccess, uploadResponseHeaders } from "@/lib/media/files";
import { mediaSubject, type MediaTokenFailure } from "@/lib/media/token";

const FAILURE_MESSAGES: Record<MediaTokenFailure, string> = {
  missing: "This video requires a signed link.",
  malformed: "This video link is invalid.",
  expired: "This video link has expired.",
  invalid: "This video link is not valid for your account.",
};

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

function forbidden(reason: MediaTokenFailure): NextResponse {
  return new NextResponse(FAILURE_MESSAGES[reason], {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Media-Token": reason,
      "X-Robots-Tag": "noindex",
    },
  });
}

function unavailable(): NextResponse {
  return new NextResponse("This video is unavailable right now.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300", "X-Robots-Tag": "noindex" },
  });
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
  const access = await resolveUploadAccess(parts, {
    root: path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir),
    token: req.nextUrl.searchParams.get(MEDIA_TOKEN_PARAM),
    protectUploads: async () => (await getSettings()).video.protectUploads,
    subject: async () => mediaSubject(await getCurrentUser()),
  });
  if (!access.ok) {
    if (access.status === 403) return forbidden(access.reason);
    if (access.status === 503) return unavailable();
    return notFound();
  }

  const file = access.file;
  const size = file.stat.size;
  const headers = uploadResponseHeaders(file, access);

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
 * `?t=` token bound to the viewer's session (see `src/lib/media`). Whether a
 * file is protected is decided from its real location on disk, so letter
 * case, NTFS stream names or other aliases of the folder cannot skip the
 * check (see `resolveUploadAccess`). Other uploads, and videos uploaded
 * before protection existed, are served as is.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, false);
}

export async function HEAD(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, true);
}
