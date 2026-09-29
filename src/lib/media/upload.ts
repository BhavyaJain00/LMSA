import "server-only";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { slugify, uid } from "@/lib/utils";
import { PROTECTED_VIDEO_DIR } from "./paths";
import { MultipartError, multipartBoundary, parseMultipart, type MultipartPart, type MultipartSink } from "./multipart";

/**
 * Receives `POST /api/upload` bodies without buffering them: the multipart
 * body is parsed as it streams in and the file part is written straight to a
 * hidden temporary file next to its destination, then renamed into place.
 *
 *  - `Content-Length` is required and checked against the viewer's limit
 *    before a single body byte is read (staff: the larger of the video and
 *    asset limits; everyone else: the asset limit), plus a small allowance
 *    for the multipart framing.
 *  - The file part's type is known from its headers, so role checks and the
 *    per-type size limit apply while streaming; the first bytes of a video
 *    are sniffed for a real container signature.
 *  - When a request is rejected mid-body, the rest of the body (bounded by
 *    the verified Content-Length) is read and discarded so the client gets
 *    the JSON error instead of a reset connection.
 */

export const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif"]);
export const DOC_TYPES = new Set([
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

const EXTENSIONS: Record<string, string> = {
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

/** Room for part headers, boundaries and the small `kind` field on top of the file itself. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** Largest non-file field accepted (the `kind` field is a few bytes). */
const MAX_FIELD_BYTES = 1024;
/** Bytes of the file sniffed to recognise a video container. */
const SNIFF_BYTES = 16;

/**
 * Cheap container sniffing so a renamed non-video file is not stored as a
 * lesson video: ISO BMFF (MP4/MOV: "ftyp"/"moov"/"mdat"/"wide"/"free" box at
 * offset 4), Matroska/WebM (EBML magic) and Ogg ("OggS").
 */
export function looksLikeVideo(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 8))) return true;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  return ascii(0, 4) === "OggS";
}

export interface UploadConfig {
  /** Absolute upload directory. */
  root: string;
  /** The uploader may upload videos and larger files (instructors, moderators, admins). */
  staff: boolean;
  maxVideoBytes: number;
  maxAssetBytes: number;
}

export type UploadResult =
  | { status: 200; body: { ok: true; url: string; name: string; size: number; type: string } }
  | { status: number; body: { ok: false; error: string } };

class UploadRejection extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadRejection";
    this.status = status;
  }
}

const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
const tooLarge = (limit: number) => new UploadRejection(413, `File is too large (max ${megabytes(limit)} MB).`);
const fail = (status: number, error: string): UploadResult => ({ status, body: { ok: false, error } });

interface StoredFile {
  originalName: string;
  type: string;
  isVideo: boolean;
  isImage: boolean;
  size: number;
  temp: string;
  target: string;
  url: string;
}

/** Read and discard what is left of the body (bounded by the verified Content-Length). */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    /* the client went away */
  }
}

async function* chunks(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Uint8Array> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("Short write while storing an upload.");
    offset += bytesWritten;
  }
}

/** Receive one upload. Never throws for client errors: the result carries the HTTP status and JSON body. */
export async function receiveUpload(request: Request, config: UploadConfig): Promise<UploadResult> {
  const boundary = multipartBoundary(request.headers.get("content-type"));
  if (!boundary || !request.body) return fail(400, "Invalid form data");

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader === null) return fail(411, "The upload size is missing (Content-Length).");
  if (!/^\d{1,15}$/.test(lengthHeader.trim())) return fail(400, "Invalid form data");
  const contentLength = Number(lengthHeader);
  const roleLimit = config.staff ? Math.max(config.maxVideoBytes, config.maxAssetBytes) : config.maxAssetBytes;
  if (contentLength > roleLimit + MULTIPART_OVERHEAD_BYTES) return fail(413, `File is too large (max ${megabytes(roleLimit)} MB).`);

  const root = path.resolve(/* turbopackIgnore: true */ config.root);
  let kind = "auto";
  let file: StoredFile | null = null;
  let handle: FileHandle | null = null;
  const reader = request.body.getReader();

  const onPart = async (part: MultipartPart): Promise<MultipartSink> => {
    if (part.name === "file" && part.filename !== null) return openFilePart(part);
    // Plain fields: only `kind` is used; everything is size-capped.
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    return {
      write(chunk) {
        bytes += chunk.byteLength;
        if (bytes > MAX_FIELD_BYTES) throw new UploadRejection(400, "Invalid form data");
        text += decoder.decode(chunk, { stream: true });
      },
      end() {
        text += decoder.decode();
        if (part.name === "kind") kind = text.trim();
      },
    };
  };

  const openFilePart = async (part: MultipartPart): Promise<MultipartSink> => {
    if (file) throw new UploadRejection(400, "Upload one file at a time.");
    const type = part.contentType || "application/octet-stream";
    const isVideo = VIDEO_TYPES.has(type);
    const isImage = IMAGE_TYPES.has(type);
    if (!isVideo && !isImage && !DOC_TYPES.has(type)) throw new UploadRejection(415, `Unsupported file type: ${type}`);
    if (isVideo && !config.staff) throw new UploadRejection(403, "Only instructors can upload videos.");
    const limit = isVideo ? config.maxVideoBytes : config.maxAssetBytes;
    // Everything in the body except the framing is this file: reject what cannot fit before writing.
    if (contentLength - MULTIPART_OVERHEAD_BYTES > limit) throw tooLarge(limit);

    const originalName = (part.filename ?? "").slice(0, 255) || "file";
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "") || EXTENSIONS[type] || "";
    const base = slugify(path.basename(originalName, path.extname(originalName))).slice(0, 40) || "file";
    const name = `${base}-${uid()}${ext}`;
    const dir = isVideo ? path.join(/* turbopackIgnore: true */ root, PROTECTED_VIDEO_DIR) : root;
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(/* turbopackIgnore: true */ dir, name);
    // Dot-files are never served by /uploads, so a half-written upload is not reachable.
    const temp = path.join(/* turbopackIgnore: true */ dir, `.${name}.${uid()}.part`);
    handle = await fs.open(temp, "wx");
    const stored: StoredFile = {
      originalName,
      type,
      isVideo,
      isImage,
      size: 0,
      temp,
      target,
      url: isVideo ? `/uploads/${PROTECTED_VIDEO_DIR}/${name}` : `/uploads/${name}`,
    };
    file = stored;
    const head: number[] = [];
    let sniffed = !isVideo;
    const sniff = () => {
      sniffed = true;
      if (!looksLikeVideo(Uint8Array.from(head))) throw new UploadRejection(415, "This file doesn't look like a video. Upload an MP4, WebM or OGG file.");
    };
    return {
      async write(chunk) {
        stored.size += chunk.byteLength;
        if (stored.size > limit) throw tooLarge(limit);
        if (!sniffed) {
          for (let i = 0; i < chunk.byteLength && head.length < SNIFF_BYTES; i++) head.push(chunk[i]!);
          if (head.length >= SNIFF_BYTES) sniff();
        }
        await writeAll(handle!, chunk);
      },
      async end() {
        if (!sniffed) sniff();
        const h = handle!;
        handle = null;
        await h.close();
      },
    };
  };

  const cleanup = async () => {
    const h = handle;
    handle = null;
    if (h) await h.close().catch(() => undefined);
    const stored = file as StoredFile | null;
    if (stored) await fs.rm(stored.temp, { force: true }).catch(() => undefined);
  };

  try {
    await parseMultipart(chunks(reader), boundary, onPart);
  } catch (err) {
    await cleanup();
    if (err instanceof UploadRejection) {
      await drain(reader);
      return fail(err.status, err.message);
    }
    if (err instanceof MultipartError) {
      await drain(reader);
      return fail(400, "Invalid form data");
    }
    await drain(reader);
    console.error("[upload] failed to store file", err instanceof Error ? err.message : err);
    return fail(500, "The file could not be saved. Please try again.");
  }
  // Anything after the closing boundary (epilogue) is ignored.
  await drain(reader);

  const stored = file as StoredFile | null;
  if (!stored) return fail(400, "No file provided");
  const rejection =
    stored.size === 0
      ? fail(400, "The file is empty.")
      : kind === "video" && !stored.isVideo
        ? fail(415, "Please upload an MP4, WebM or OGG video.")
        : kind === "image" && !stored.isImage
          ? fail(415, "Please upload an image.")
          : null;
  if (rejection) {
    await cleanup();
    return rejection;
  }
  try {
    await fs.rename(stored.temp, stored.target);
  } catch (err) {
    await cleanup();
    console.error("[upload] failed to store file", err instanceof Error ? err.message : err);
    return fail(500, "The file could not be saved. Please try again.");
  }
  return { status: 200, body: { ok: true, url: stored.url, name: stored.originalName, size: stored.size, type: stored.type } };
}
