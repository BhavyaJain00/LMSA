import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { PROTECTED_VIDEO_DIR } from "@/lib/media/paths";
import { slugify, uid } from "@/lib/utils";

const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif"]);
const DOC_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/vtt",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

/**
 * Cheap container sniffing so a renamed non-video file is not stored as a
 * lesson video: ISO BMFF (MP4/MOV: "ftyp"/"moov"/"mdat"/"wide"/"free" box at
 * offset 4), Matroska/WebM (EBML magic) and Ogg ("OggS").
 */
function looksLikeVideo(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 8))) return true;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  return ascii(0, 4) === "OggS";
}

/**
 * File upload endpoint (multipart/form-data with a `file` field and optional `kind`).
 * Staff may upload anything supported; students may upload documents/images
 * (assignment submissions, avatars). Files are stored under the upload dir
 * and served from /uploads/<name>. Videos go to /uploads/videos/<name>, where
 * they can be protected with signed, expiring URLs (Settings → Video).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  const kind = (form.get("kind") as string | null) ?? "auto";
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });

  const type = file.type || "application/octet-stream";
  const isVideo = VIDEO_TYPES.has(type);
  const isImage = IMAGE_TYPES.has(type);
  const isDoc = DOC_TYPES.has(type);
  if (!isVideo && !isImage && !isDoc) return NextResponse.json({ ok: false, error: `Unsupported file type: ${type}` }, { status: 415 });
  if (kind === "video" && !isVideo) return NextResponse.json({ ok: false, error: "Please upload an MP4, WebM or OGG video." }, { status: 415 });
  if (kind === "image" && !isImage) return NextResponse.json({ ok: false, error: "Please upload an image." }, { status: 415 });
  if (isVideo && !isStaff(user)) return NextResponse.json({ ok: false, error: "Only instructors can upload videos." }, { status: 403 });
  if (file.size === 0) return NextResponse.json({ ok: false, error: "The file is empty." }, { status: 400 });

  const limit = isVideo ? siteConfig.maxUploadBytes : siteConfig.maxAssetBytes;
  if (file.size > limit) return NextResponse.json({ ok: false, error: `File is too large (max ${Math.round(limit / 1024 / 1024)} MB).` }, { status: 413 });

  if (isVideo) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!looksLikeVideo(head)) return NextResponse.json({ ok: false, error: "This file doesn't look like a video. Upload an MP4, WebM or OGG file." }, { status: 415 });
  }

  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "") || extFor(type);
  const base = slugify(path.basename(file.name, path.extname(file.name))).slice(0, 40) || "file";
  const name = `${base}-${uid()}${ext}`;
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir);
  const dir = isVideo ? path.join(/* turbopackIgnore: true */ root, PROTECTED_VIDEO_DIR) : root;
  await fs.mkdir(dir, { recursive: true });

  // Stream to a temporary file, then rename, so a failed upload never leaves a partial file behind.
  const target = path.join(/* turbopackIgnore: true */ dir, name);
  const temp = `${target}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>), createWriteStream(temp, { flags: "wx" }));
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    console.error("[upload] failed to store file", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "The file could not be saved. Please try again." }, { status: 500 });
  }

  const url = isVideo ? `/uploads/${PROTECTED_VIDEO_DIR}/${name}` : `/uploads/${name}`;
  return NextResponse.json({ ok: true, url, name: file.name, size: file.size, type });
}

function extFor(type: string): string {
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "video/quicktime": ".mov",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/vtt": ".vtt",
    "application/zip": ".zip",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
  };
  return map[type] ?? "";
}
