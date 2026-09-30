import type { UploadKind } from "@/lib/types";
import { slugify } from "@/lib/utils";

/**
 * Resumable (chunked) upload protocol — pure rules shared by the server
 * routes (`/api/uploads/**`), the `FileUpload` component and tests.
 *
 *   POST   /api/uploads               { kind, fileName, size, mimeType } → { id, chunkSize, offset }
 *   HEAD   /api/uploads/:id           → Upload-Offset / Upload-Length headers
 *   PATCH  /api/uploads/:id           Upload-Offset: <n>, raw chunk body → { offset }
 *   POST   /api/uploads/:id/complete  → { url, name, size, type }
 *   DELETE /api/uploads/:id           → aborts and removes the partial file
 *
 * Every chunk must start exactly where the stored bytes end; a chunk cut off
 * by a dropped connection keeps what arrived, and the client asks for the
 * offset (HEAD) before sending the rest. Keep this module free of Node-only
 * imports: it runs in the browser too.
 */

const KiB = 1024;
const MiB = 1024 * KiB;

/** Chunk size handed to clients (8 MiB). */
export const DEFAULT_CHUNK_SIZE = 8 * MiB;
/** Largest single PATCH body accepted (clients may send bigger chunks on fast links). */
export const MAX_CHUNK_BYTES = 64 * MiB;
/** Files at or below this size go through the single-request `/api/upload` (unless they are videos). */
export const RESUMABLE_THRESHOLD = 8 * MiB;
/** Unfinished uploads one account may have at a time. */
export const MAX_ACTIVE_SESSIONS_PER_USER = 6;
/** Unfinished uploads without activity for this long are removed. */
export const STALE_SESSION_MS = 24 * 60 * 60 * 1000;
/** Finished or aborted session records are kept this long (for the admin overview), then deleted. */
export const SESSION_RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FILE_NAME_LENGTH = 255;

/** Response headers of the protocol. */
export const UPLOAD_OFFSET_HEADER = "Upload-Offset";
export const UPLOAD_LENGTH_HEADER = "Upload-Length";

/* ------------------------------------------------------------------ */
/* Accepted file types                                                  */
/* ------------------------------------------------------------------ */

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

/** Default extension for each accepted type. */
export const TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
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
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".weba",
};

/** Extensions a file of each type may carry (the stored name keeps the uploader's extension when it is one of these). */
const ALLOWED_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "video/mp4": [".mp4", ".m4v"],
  "video/webm": [".webm"],
  "video/ogg": [".ogv", ".ogg"],
  "video/quicktime": [".mov", ".qt"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "image/avif": [".avif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".text", ".log", ".csv"],
  "text/markdown": [".md", ".markdown"],
  "text/vtt": [".vtt"],
  "application/zip": [".zip"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a", ".mp4"],
  "audio/ogg": [".ogg", ".oga", ".opus"],
  "audio/wav": [".wav"],
  "audio/webm": [".weba", ".webm"],
};

/** Type for an extension when the browser reports none (or a generic one). */
const EXTENSION_TYPES: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  // Videos first so ".mp4"/".webm"/".ogg" resolve to the video type.
  for (const type of [...VIDEO_TYPES, ...IMAGE_TYPES, ...DOC_TYPES]) {
    for (const ext of ALLOWED_EXTENSIONS[type] ?? []) out[ext] ??= type;
  }
  return out;
})();

/** Aliases browsers and operating systems report for accepted types. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "video/x-m4v": "video/mp4",
  "application/x-zip-compressed": "application/zip",
  "text/x-markdown": "text/markdown",
};

export type FileCategory = "video" | "image" | "document";

export function categoryOf(type: string): FileCategory | null {
  if (VIDEO_TYPES.has(type)) return "video";
  if (IMAGE_TYPES.has(type)) return "image";
  if (DOC_TYPES.has(type)) return "document";
  return null;
}

/** Lower-case extension of a file name ("Intro.MP4" → ".mp4"), "" when there is none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/** Normalized MIME type of a file: the reported type (without parameters), an alias, or one inferred from the extension. */
export function resolveFileType(mimeType: string | null | undefined, fileName: string): string {
  const reported = (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  const aliased = TYPE_ALIASES[reported] ?? reported;
  if (aliased && aliased !== "application/octet-stream" && categoryOf(aliased)) return aliased;
  const fromExt = EXTENSION_TYPES[extensionOf(fileName)];
  return fromExt ?? (aliased || "application/octet-stream");
}

/* ------------------------------------------------------------------ */
/* Starting an upload                                                   */
/* ------------------------------------------------------------------ */

export interface UploadStartInput {
  kind?: unknown;
  fileName?: unknown;
  size?: unknown;
  mimeType?: unknown;
}

export interface UploadPolicy {
  /** Instructors, moderators and admins: may upload videos and larger files. */
  staff: boolean;
  maxVideoBytes: number;
  maxAssetBytes: number;
}

export type UploadStartDecision =
  | { ok: true; kind: UploadKind | "auto"; fileName: string; size: number; type: string; category: FileCategory; ext: string }
  | { ok: false; status: 400 | 403 | 413 | 415; error: string };

const megabytes = (bytes: number) => Math.round(bytes / MiB).toLocaleString("en-US");

/** Largest file a viewer may upload of a category. */
export function uploadLimitFor(category: FileCategory, policy: UploadPolicy): number {
  return category === "video" ? policy.maxVideoBytes : policy.maxAssetBytes;
}

/**
 * Validate the metadata sent to start an upload: name, declared size, type
 * and extension, the uploader's role and the size limit of the category.
 * The bytes themselves are checked again when the upload completes (videos
 * are sniffed for a real container signature).
 */
export function validateUploadStart(input: UploadStartInput, policy: UploadPolicy): UploadStartDecision {
  const kind = input.kind === undefined || input.kind === null || input.kind === "" ? "auto" : input.kind;
  if (kind !== "video" && kind !== "image" && kind !== "document" && kind !== "auto") return { ok: false, status: 400, error: "Unknown upload kind." };

  const rawName = typeof input.fileName === "string" ? input.fileName.normalize("NFC").trim() : "";
  const fileName = (rawName.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!fileName) return { ok: false, status: 400, error: "The file name is missing." };
  if (fileName.length > MAX_FILE_NAME_LENGTH) return { ok: false, status: 400, error: "The file name is too long (max 255 characters)." };

  const size = typeof input.size === "number" ? input.size : typeof input.size === "string" && /^\d{1,16}$/.test(input.size) ? Number(input.size) : NaN;
  if (!Number.isSafeInteger(size) || size < 0) return { ok: false, status: 400, error: "The file size is missing or invalid." };
  if (size === 0) return { ok: false, status: 400, error: "The file is empty." };

  const type = resolveFileType(typeof input.mimeType === "string" ? input.mimeType : "", fileName);
  const category = categoryOf(type);
  if (!category) return { ok: false, status: 415, error: `Unsupported file type: ${type}` };
  if (kind === "video" && category !== "video") return { ok: false, status: 415, error: "Please upload an MP4, WebM, OGG or MOV video." };
  if (kind === "image" && category !== "image") return { ok: false, status: 415, error: "Please upload an image." };
  if (category === "video" && !policy.staff) return { ok: false, status: 403, error: "Only instructors can upload videos." };

  const nameExt = extensionOf(fileName);
  const allowed = ALLOWED_EXTENSIONS[type] ?? [];
  if (nameExt && !allowed.includes(nameExt) && EXTENSION_TYPES[nameExt] !== undefined && categoryOf(EXTENSION_TYPES[nameExt]!) !== category) {
    return { ok: false, status: 415, error: "The file extension does not match its type." };
  }
  const ext = nameExt && allowed.includes(nameExt) ? nameExt : (TYPE_EXTENSIONS[type] ?? "");

  const limit = uploadLimitFor(category, policy);
  if (size > limit) return { ok: false, status: 413, error: `File is too large (max ${megabytes(limit)} MB).` };
  return { ok: true, kind, fileName, size, type, category, ext };
}

/** Stored file name: a slug of the original name, a unique id and the extension (`intro-to-css-<id>.mp4`). */
export function storedFileName(fileName: string, ext: string, id: string): string {
  const withoutExt = fileName.replace(/\.[^.]*$/, "");
  const base = slugify(withoutExt).slice(0, 40).replace(/-+$/, "");
  const safeId = id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-16) || "0";
  return `${base}-${safeId}${ext}`;
}

/* ------------------------------------------------------------------ */
/* Chunks                                                               */
/* ------------------------------------------------------------------ */

/** Parse an `Upload-Offset` header: a non-negative safe integer, else null. */
export function parseOffsetHeader(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (!/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse a `Content-Length` header (null when absent or invalid). */
export function parseContentLength(value: string | null | undefined): number | null {
  return parseOffsetHeader(value);
}

export type ChunkCheck =
  | { ok: true; offset: number; maxBytes: number }
  | { ok: false; status: 400 | 409 | 413; error: string; offset: number };

/**
 * Check a PATCH before any body byte is read: the declared offset must be
 * where the stored bytes end (`stored`), the body must fit in what is left of
 * the file and under the per-chunk limit. `maxBytes` is how much the body may
 * still carry (the stream is cut off beyond it).
 */
export function checkChunk(stored: number, total: number, offsetHeader: string | null | undefined, contentLengthHeader: string | null | undefined, maxChunk = MAX_CHUNK_BYTES): ChunkCheck {
  const offset = parseOffsetHeader(offsetHeader);
  if (offset === null) return { ok: false, status: 400, error: "The Upload-Offset header is missing or invalid.", offset: stored };
  if (offset !== stored) return { ok: false, status: 409, error: `The upload is at byte ${stored}, not ${offset}. Resume from there.`, offset: stored };
  const remaining = total - stored;
  if (remaining <= 0) return { ok: false, status: 409, error: "Every byte of this file has already been received.", offset: stored };
  const maxBytes = Math.min(remaining, maxChunk);
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const length = parseContentLength(contentLengthHeader);
    if (length === null) return { ok: false, status: 400, error: "Invalid Content-Length.", offset: stored };
    if (length > remaining) return { ok: false, status: 413, error: "This chunk goes past the end of the file.", offset: stored };
    if (length > maxChunk) return { ok: false, status: 413, error: `Chunks may be at most ${megabytes(maxChunk)} MB.`, offset: stored };
  }
  return { ok: true, offset, maxBytes };
}

/** Byte range of the next chunk to send from `offset`. */
export function nextChunkRange(offset: number, total: number, chunkSize: number): { start: number; end: number } | null {
  if (!(chunkSize > 0) || offset >= total) return null;
  return { start: offset, end: Math.min(total, offset + chunkSize) };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                             */
/* ------------------------------------------------------------------ */

/** An unfinished session without activity for `STALE_SESSION_MS`. */
export function isStaleSession(session: { status: string; updatedAt: string }, now: number, staleMs = STALE_SESSION_MS): boolean {
  if (session.status !== "uploading") return false;
  const updated = Date.parse(session.updatedAt);
  return !Number.isFinite(updated) || now - updated > staleMs;
}

/** Unfinished, non-stale sessions (what counts towards the per-user limit). */
export function countActiveSessions(sessions: readonly { userId: string; status: string; updatedAt: string }[], userId: string, now: number): number {
  return sessions.filter((s) => s.userId === userId && s.status === "uploading" && !isStaleSession(s, now)).length;
}

/* ------------------------------------------------------------------ */
/* Client helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Delay before retry number `attempt` (1-based): exponential from `baseMs`,
 * capped at `maxMs`, with up to 25% random jitter so many clients do not
 * retry in lockstep. `random` is injectable for tests.
 */
export function retryDelayMs(attempt: number, baseMs = 1000, maxMs = 30_000, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(maxMs, baseMs * 2 ** (n - 1));
  return Math.round(exp * (0.75 + random() * 0.25));
}

/** Retries per chunk before the upload pauses with an error (the user can resume). */
export const MAX_CHUNK_RETRIES = 6;

/** Prefix of every localStorage key remembering an unfinished upload. */
export const RESUME_KEY_PREFIX = "ll-upload:";

/** localStorage key remembering an unfinished upload of this exact file. */
export function resumeKeyFor(file: { name: string; size: number; lastModified: number }, kind: string): string {
  return `${RESUME_KEY_PREFIX}${kind}:${file.size}:${file.lastModified}:${file.name}`;
}

/** What the browser remembers about an unfinished upload (so a reload can continue it). */
export interface ResumeRecord {
  /** Upload session id on the server. */
  id: string;
  fileName: string;
  size: number;
  /** Last offset the server confirmed (for the "unfinished upload" notice). */
  offset: number;
  /** When the record was last written (epoch ms). */
  savedAt: number;
  /** Which uploader started it (so each field only lists its own leftovers). */
  scope: string;
}

/**
 * Parse a stored resume record; null when it is malformed or older than the
 * server keeps idle sessions (`STALE_SESSION_MS`).
 */
export function parseResumeRecord(raw: string | null | undefined, now: number): ResumeRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^ups_[a-z0-9]{8,32}$/.test(r.id)) return null;
  if (typeof r.fileName !== "string" || !r.fileName) return null;
  if (typeof r.size !== "number" || !Number.isSafeInteger(r.size) || r.size <= 0) return null;
  if (typeof r.offset !== "number" || !Number.isSafeInteger(r.offset) || r.offset < 0 || r.offset > r.size) return null;
  if (typeof r.savedAt !== "number" || !Number.isFinite(r.savedAt) || now - r.savedAt > STALE_SESSION_MS || r.savedAt - now > 60_000) return null;
  const scope = typeof r.scope === "string" ? r.scope : "";
  return { id: r.id, fileName: r.fileName, size: r.size, offset: r.offset, savedAt: r.savedAt, scope };
}

/**
 * Whether a file goes through the resumable protocol: every video and
 * anything larger than one chunk. Small images and documents keep using the
 * single-request `/api/upload`.
 */
export function shouldUseResumable(file: { name: string; size: number; type: string }): boolean {
  return categoryOf(resolveFileType(file.type, file.name)) === "video" || file.size > RESUMABLE_THRESHOLD;
}

/** Chunk size to use: what the server suggests, kept within sane bounds. */
export function effectiveChunkSize(suggested: unknown): number {
  const n = typeof suggested === "number" && Number.isSafeInteger(suggested) ? suggested : DEFAULT_CHUNK_SIZE;
  return Math.min(MAX_CHUNK_BYTES, Math.max(256 * KiB, n));
}

/**
 * Smoothed transfer speed (bytes/s): an exponential moving average of the
 * previous estimate and the rate over the last sample window.
 */
export function smoothSpeed(previous: number, bytes: number, elapsedMs: number, weight = 0.3): number {
  if (!(elapsedMs > 0) || bytes < 0) return previous;
  const instant = (bytes * 1000) / elapsedMs;
  return previous > 0 ? previous * (1 - weight) + instant * weight : instant;
}

/** "about 3 min left" style text for a number of seconds. */
export function describeTimeLeft(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) return "a few seconds left";
  if (seconds < 60) return `${Math.ceil(seconds / 5) * 5} s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min left` : `about ${hours} h left`;
}

/** Statuses after which retrying the same request cannot succeed. */
export function isFatalUploadStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410 || status === 413 || status === 415;
}

/** Seconds left at the current speed (null while the speed is unknown). */
export function estimateRemaining(bytesLeft: number, bytesPerSecond: number): number | null {
  if (!(bytesPerSecond > 0) || !(bytesLeft >= 0)) return null;
  return Math.ceil(bytesLeft / bytesPerSecond);
}
