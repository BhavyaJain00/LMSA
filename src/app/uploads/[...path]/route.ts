import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Settings } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { MEDIA_TOKEN_PARAM, encodeMediaPath } from "@/lib/media/paths";
import { mediaResponseHeaders, resolveRemoteUploadAccess, resolveUploadAccess } from "@/lib/media/files";
import { MAX_PLAYLIST_BYTES, isPlaylistPath } from "@/lib/media/hls";
import { isHlsPart, signPlaylist } from "@/lib/media/serve";
import { signedUrlTtlSeconds } from "@/lib/media/sign";
import { mediaSubject, type MediaTokenFailure } from "@/lib/media/token";
import { parseByteRange } from "@/lib/storage/range";
import { getStorage, isRemoteStorage, publicBaseUrl, uploadRoot } from "@/lib/storage";

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

function unsatisfiable(headers: Record<string, string>, size: number | null): NextResponse {
  return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size ?? "*"}` } });
}

/** Answer a playlist: signed playlists get per-child tokens for the same viewer, others are sent as stored. */
function playlistResponse(text: string, headers: Record<string, string>, head: boolean, sign: ((text: string) => string) | null): NextResponse {
  const body = sign ? sign(text) : text;
  const bytes = Buffer.from(body, "utf8");
  const out = { ...headers, "Content-Length": String(bytes.byteLength) };
  // A playlist is always sent whole (Range is ignored), and signed ones embed fresh tokens: never cache them.
  if (sign) out["Cache-Control"] = "private, no-store";
  return new NextResponse(head ? null : bytes, { status: 200, headers: out });
}

interface Ctx {
  head: boolean;
  range: string | null;
  settings: Settings;
  subject: () => Promise<string>;
}

async function serveLocal(ctx: Ctx, access: Extract<Awaited<ReturnType<typeof resolveUploadAccess>>, { ok: true }>, requestPath: string): Promise<NextResponse> {
  const file = access.file;
  const size = file.stat.size;
  const hlsPart = isHlsPart(file.canonicalPath ?? requestPath);
  const headers = mediaResponseHeaders({ ext: file.ext, lastModified: file.stat.mtime, hlsPart }, access);

  if (isPlaylistPath(file.filePath)) {
    if (size > MAX_PLAYLIST_BYTES) return notFound();
    const text = await fs.readFile(file.filePath, "utf8");
    const playlistPath = file.canonicalPath ?? requestPath;
    const subject = access.signed ? await ctx.subject() : null;
    const ttl = signedUrlTtlSeconds(ctx.settings);
    return playlistResponse(text, headers, ctx.head, subject ? (t) => signPlaylist(t, playlistPath, subject, ttl) : null);
  }

  const range = parseByteRange(ctx.range, size);
  if (range === "invalid") return unsatisfiable(headers, size);
  if (range) {
    const length = range.end - range.start + 1;
    const rangeHeaders = { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(length) };
    if (ctx.head) return new NextResponse(null, { status: 206, headers: rangeHeaders });
    const stream = Readable.toWeb(createReadStream(file.filePath, { start: range.start, end: range.end })) as ReadableStream;
    return new NextResponse(stream, { status: 206, headers: rangeHeaders });
  }
  const fullHeaders = { ...headers, "Content-Length": String(size) };
  if (ctx.head) return new NextResponse(null, { status: 200, headers: fullHeaders });
  const stream = Readable.toWeb(createReadStream(file.filePath)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: fullHeaders });
}

async function serveRemote(ctx: Ctx, parts: string[], token: string | null): Promise<NextResponse> {
  const access = await resolveRemoteUploadAccess(parts, {
    token,
    protectUploads: async () => ctx.settings.video.protectUploads,
    subject: ctx.subject,
  });
  if (!access.ok) {
    if (access.status === 403) return forbidden(access.reason);
    if (access.status === 503) return unavailable();
    return notFound();
  }

  // Unprotected files are served by the CDN / public bucket origin when one is configured.
  const base = publicBaseUrl(ctx.settings);
  if (base && !access.signed) {
    return NextResponse.redirect(`${base}${encodeMediaPath(`/${access.key}`)}`, {
      status: 302,
      headers: { "Cache-Control": access.videoDir ? "private, max-age=300" : "public, max-age=3600" },
    });
  }

  const storage = getStorage();
  const hlsPart = isHlsPart(access.key);
  if (isPlaylistPath(access.key)) {
    const text = await storage.readText(access.key, MAX_PLAYLIST_BYTES);
    if (text === null) return notFound();
    const headers = mediaResponseHeaders({ ext: access.ext, hlsPart }, access);
    const subject = access.signed ? await ctx.subject() : null;
    const ttl = signedUrlTtlSeconds(ctx.settings);
    return playlistResponse(text, headers, ctx.head, subject ? (t) => signPlaylist(t, access.path, subject, ttl) : null);
  }

  if (ctx.head) {
    const info = await storage.head(access.key);
    if (!info) return notFound();
    const headers = mediaResponseHeaders({ ext: access.ext, lastModified: info.lastModified, hlsPart }, access);
    return new NextResponse(null, { status: 200, headers: { ...headers, "Content-Length": String(info.size) } });
  }

  const result = await storage.read(access.key, ctx.range);
  if (result === null) return notFound();
  const baseHeaders = mediaResponseHeaders({ ext: access.ext, hlsPart }, access);
  if (result === "unsatisfiable") return unsatisfiable(baseHeaders, null);
  const headers = mediaResponseHeaders({ ext: access.ext, lastModified: result.lastModified, hlsPart }, access);
  const out: Record<string, string> = { ...headers, "Content-Length": String(result.length) };
  if (result.status === 206 && result.contentRange) out["Content-Range"] = result.contentRange;
  if (result.etag) out.ETag = result.etag;
  return new NextResponse(result.body, { status: result.status, headers: out });
}

async function serve(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">, head: boolean): Promise<NextResponse> {
  const { path: parts } = await ctx.params;
  const token = req.nextUrl.searchParams.get(MEDIA_TOKEN_PARAM);
  let settings: Settings | null = null;
  const loadSettings = async () => (settings ??= await getSettings());
  let subject: Promise<string> | null = null;
  const context = async (): Promise<Ctx> => ({
    head,
    range: req.headers.get("range"),
    settings: await loadSettings(),
    subject: () => (subject ??= getCurrentUser().then((u) => mediaSubject(u))),
  });

  const access = await resolveUploadAccess(parts, {
    root: uploadRoot(),
    token,
    protectUploads: async () => (await loadSettings()).video.protectUploads,
    subject: async () => (await context()).subject(),
  });
  if (access.ok) return serveLocal(await context(), access, `/uploads/${parts.join("/")}`);
  if (access.status === 403) return forbidden(access.reason);
  if (access.status === 503) return unavailable();

  // Not on local disk: with object storage, the file may live in the bucket.
  if (!isRemoteStorage()) return notFound();
  try {
    return await serveRemote(await context(), parts, token);
  } catch (err) {
    console.error("[uploads] object storage read failed:", err instanceof Error ? err.message : err);
    return new NextResponse("The file could not be loaded from storage. Please try again.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
}

/**
 * Serves uploaded files with HTTP Range support so the custom video player
 * can seek inside self-hosted videos, plus the HLS streams produced by the
 * transcoder.
 *
 * Lesson videos live under `/uploads/videos/`. While
 * `settings.video.protectUploads` is on they require a signed, expiring
 * `?t=` token bound to the viewer's session (see `src/lib/media`). Whether a
 * file is protected is decided from its real location on disk, so letter
 * case, NTFS stream names or other aliases of the folder cannot skip the
 * check (see `resolveUploadAccess`). A signed HLS playlist is rewritten so
 * each child playlist and segment carries its own token for the same viewer.
 *
 * With S3-compatible storage, files that are not on local disk are read from
 * the bucket (protected ones through this route, others redirected to the
 * CDN / public bucket URL when one is configured).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, false);
}

export async function HEAD(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  return serve(req, ctx, true);
}
