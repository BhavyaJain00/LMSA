import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
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
 * File upload endpoint (multipart/form-data with a `file` field and optional `kind`).
 * Staff may upload anything supported; students may upload documents/images
 * (assignment submissions, avatars). Files are stored under storage/uploads and
 * served from /uploads/<name>.
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

  const limit = isVideo ? siteConfig.maxUploadBytes : siteConfig.maxAssetBytes;
  if (file.size > limit) return NextResponse.json({ ok: false, error: `File is too large (max ${Math.round(limit / 1024 / 1024)} MB).` }, { status: 413 });

  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "") || extFor(type);
  const base = slugify(path.basename(file.name, path.extname(file.name))).slice(0, 40) || "file";
  const name = `${base}-${uid()}${ext}`;
  const dir = path.join(process.cwd(), siteConfig.uploadDir);
  await fs.mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, name), buffer);

  return NextResponse.json({ ok: true, url: `/uploads/${name}`, name: file.name, size: file.size, type });
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
