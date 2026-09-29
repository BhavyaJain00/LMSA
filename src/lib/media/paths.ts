/**
 * Media URL helpers shared by the server (signing, file serving, access
 * checks) and the browser (the player refreshing signed URLs).
 *
 * Keep this module free of Node-only and `server-only` imports.
 *
 * Signed media URLs look like `/uploads/videos/<file>?t=<expiresUnix>.<sig>`
 * where `sig` is base64url(HMAC-SHA256(APP_SECRET, `${path}|${subject}|${expires}`)).
 * `path` is the case-folded key (`mediaPathKey`) of the canonical, decoded
 * pathname (see `canonicalMediaPath`) and `subject` the viewer's user id (or
 * `guest` for signed-out visitors).
 */

export const UPLOADS_PREFIX = "/uploads/";
/** Sub-directory of the upload dir that holds lesson videos. */
export const PROTECTED_VIDEO_DIR = "videos";
export const PROTECTED_VIDEO_PREFIX = `${UPLOADS_PREFIX}${PROTECTED_VIDEO_DIR}/`;
/** Query parameter carrying the signed token. */
export const MEDIA_TOKEN_PARAM = "t";
/** Signature subject used for signed-out visitors (free preview lessons). */
export const GUEST_MEDIA_SUBJECT = "guest";
/** Shape of a token: `<unix seconds>.<43 base64url chars>` (HMAC-SHA256). */
export const MEDIA_TOKEN_PATTERN = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/;

const PLACEHOLDER_BASE = "http://media.invalid";

/* ------------------------------------------------------------------ */
/* Upload path safety and identity                                      */
/* ------------------------------------------------------------------ */

/** Reserved DOS device names (`CON`, `NUL.mp4`, `COM1`…), which Windows resolves to devices, not files. */
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])[ ]*(?:\..*)?$/i;
/** Separators, NUL/control characters and the characters Windows forbids in names (":" selects NTFS streams). */
const FORBIDDEN_SEGMENT_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\/]/;
const MAX_SEGMENT_LENGTH = 255;

/**
 * Whether one decoded path segment of an upload URL can only name a regular
 * entry of the upload directory. Uploads are stored under generated names
 * (`slug-uid.ext`, lower-case ASCII), so everything rejected here only comes
 * from crafted URLs:
 *  - `:` selects NTFS alternate data streams (`videos::$INDEX_ALLOCATION` is
 *    the `videos` folder itself) and drive letters;
 *  - Windows drops trailing dots and spaces (`videos.` opens `videos`);
 *  - reserved device names and characters Windows forbids never name a file;
 *  - separators (an encoded `%2F`/`%5C`), NUL, `.`/`..` would escape the
 *    segment, and dot-files (in-progress `.part` uploads, `.app-secret` when
 *    the upload dir is misconfigured) are never public.
 */
export function isSafeUploadSegment(segment: string): boolean {
  if (!segment || segment.length > MAX_SEGMENT_LENGTH) return false;
  if (segment.startsWith(".")) return false;
  if (segment.endsWith(".") || segment.endsWith(" ")) return false;
  if (FORBIDDEN_SEGMENT_CHARS.test(segment)) return false;
  return !WINDOWS_RESERVED_NAME.test(segment);
}

/**
 * Case- and width-folded identity of a canonical media path. Signatures and
 * "which lesson plays this file" checks compare keys, never raw paths:
 * `/uploads/Videos/INTRO.MP4` and `/uploads/videos/intro.mp4` name the same
 * file on case-insensitive filesystems (NTFS, APFS), so they must share one
 * token and one set of permissions. Generated upload names are lower-case
 * ASCII, for which the key is the path itself.
 */
export function mediaPathKey(path: string): string {
  return path.normalize("NFKC").toUpperCase().toLowerCase();
}

/** Whether two canonical media paths name the same resource. */
export function sameMediaPath(a: string, b: string): boolean {
  return mediaPathKey(a) === mediaPathKey(b);
}

/** Path below `/uploads/` is inside the protected video directory (case-insensitive, like the filesystem). */
function inProtectedVideoDir(uploadRelative: string): boolean {
  const key = mediaPathKey(uploadRelative);
  return key.startsWith(`${PROTECTED_VIDEO_DIR}/`) && key.length > PROTECTED_VIDEO_DIR.length + 1;
}

export interface UploadRequestPath {
  /** "/"-separated name relative to the upload directory, e.g. `videos/intro-abc.mp4`. */
  name: string;
  /** Canonical media path, e.g. `/uploads/videos/intro-abc.mp4`. */
  path: string;
  /** The URL points into the protected video directory (compared case-insensitively). */
  inVideoDir: boolean;
}

/**
 * Validate the decoded segments of a `/uploads/[...path]` request. Returns
 * null when any segment is unsafe (see `isSafeUploadSegment`), so crafted
 * names never reach the filesystem.
 */
export function parseUploadRequestPath(parts: readonly string[]): UploadRequestPath | null {
  if (!parts.length || parts.length > 32) return null;
  if (!parts.every((p) => typeof p === "string" && isSafeUploadSegment(p))) return null;
  const name = parts.join("/");
  return { name, path: `${UPLOADS_PREFIX}${name}`, inVideoDir: inProtectedVideoDir(name) };
}

export interface ParsedMediaSrc {
  /** Canonical decoded pathname, e.g. `/uploads/videos/intro-abc.mp4`. */
  path: string;
  /** Raw token from `?t=` (not verified), if any. */
  token: string | null;
  /** The URL points at this site's upload route. */
  isUpload: boolean;
  /** The URL points at a lesson video that may require a signed token. */
  isProtectedVideo: boolean;
}

/**
 * Decode and validate a pathname. Returns null for malformed encodings or
 * traversal segments so a path can never escape the upload directory.
 */
export function canonicalMediaPath(pathname: string): string | null {
  if (!pathname.startsWith("/")) return null;
  const out: string[] = [];
  const segments = pathname.split("/");
  for (let i = 1; i < segments.length; i++) {
    const raw = segments[i]!;
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (seg === "" && i < segments.length - 1) return null;
    if (seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\") || seg.includes("\0")) return null;
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** Re-encode a canonical path for use in a URL. */
export function encodeMediaPath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse a media src. Relative URLs (`/uploads/…`) always count as this site;
 * absolute URLs only when their origin is one of `siteOrigins`.
 * Returns null for anything that is not a URL on this site.
 */
export function parseMediaSrc(src: string, siteOrigins: readonly string[] = []): ParsedMediaSrc | null {
  const value = (src ?? "").trim();
  if (!value) return null;
  let url: URL;
  const relative = value.startsWith("/") && !value.startsWith("//");
  try {
    url = relative ? new URL(value, PLACEHOLDER_BASE) : new URL(value);
  } catch {
    return null;
  }
  if (!relative) {
    const allowed = siteOrigins.map(normalizeOrigin).filter((o): o is string => !!o);
    if (!allowed.includes(url.origin.toLowerCase())) return null;
  }
  const path = canonicalMediaPath(url.pathname);
  if (!path) return null;
  const uploadName = path.startsWith(UPLOADS_PREFIX) ? path.slice(UPLOADS_PREFIX.length) : "";
  // The route prefix is matched as-is (URL routing is case-sensitive); the rest names files, so
  // the video directory is recognised in any letter case. Unsafe names are never uploads.
  const isUpload = uploadName.length > 0 && uploadName.split("/").every(isSafeUploadSegment);
  const isProtectedVideo = isUpload && inProtectedVideoDir(uploadName);
  return { path, token: url.searchParams.get(MEDIA_TOKEN_PARAM), isUpload, isProtectedVideo };
}

/** Whether a canonical path lives in the protected video directory (any letter case). */
export function isProtectedVideoPath(path: string): boolean {
  return path.startsWith(UPLOADS_PREFIX) && inProtectedVideoDir(path.slice(UPLOADS_PREFIX.length));
}

/** Build `/uploads/videos/x.mp4?t=<token>` from a canonical path. */
export function withMediaToken(path: string, token: string): string {
  return `${encodeMediaPath(path)}?${MEDIA_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/**
 * Remove the signed token from a src (keeps any other query parameters).
 * Used before storing a src (watch records) or comparing two srcs.
 */
export function stripMediaToken(src: string): string {
  const value = (src ?? "").trim();
  const q = value.indexOf("?");
  if (q === -1) return value;
  const hashIndex = value.indexOf("#", q);
  const base = value.slice(0, q);
  const query = value.slice(q + 1, hashIndex === -1 ? undefined : hashIndex);
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex);
  const params = new URLSearchParams(query);
  params.delete(MEDIA_TOKEN_PARAM);
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ""}${hash}`;
}

/** Expiry (unix seconds) encoded in a src's token, or null when unsigned/malformed. */
export function mediaTokenExpiry(src: string): number | null {
  const q = src.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(src.slice(q + 1).split("#")[0]);
  const token = params.get(MEDIA_TOKEN_PARAM);
  if (!token) return null;
  const m = MEDIA_TOKEN_PATTERN.exec(token);
  return m ? Number(m[1]) : null;
}

/** Split a raw token into its parts (no verification). */
export function splitMediaToken(token: string | null | undefined): { expires: number; signature: string } | null {
  if (!token) return null;
  const m = MEDIA_TOKEN_PATTERN.exec(token);
  if (!m) return null;
  const expires = Number(m[1]);
  if (!Number.isSafeInteger(expires)) return null;
  return { expires, signature: m[2]! };
}

/** Compare two srcs ignoring signed tokens (and, for same-site URLs, the origin). */
export function sameMediaSource(a: string | undefined | null, b: string | undefined | null, siteOrigins: readonly string[] = []): boolean {
  if (!a || !b) return false;
  const pa = parseMediaSrc(a, siteOrigins);
  const pb = parseMediaSrc(b, siteOrigins);
  if (pa && pb) return pa.isUpload && pb.isUpload ? sameMediaPath(pa.path, pb.path) : pa.path === pb.path;
  return stripMediaToken(a) === stripMediaToken(b);
}
