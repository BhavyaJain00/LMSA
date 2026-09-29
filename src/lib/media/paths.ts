/**
 * Media URL helpers shared by the server (signing, file serving, access
 * checks) and the browser (the player refreshing signed URLs).
 *
 * Keep this module free of Node-only and `server-only` imports.
 *
 * Signed media URLs look like `/uploads/videos/<file>?t=<expiresUnix>.<sig>`
 * where `sig` is base64url(HMAC-SHA256(APP_SECRET, `${path}|${subject}|${expires}`)).
 * `path` is the canonical, decoded pathname (see `canonicalMediaPath`) and
 * `subject` the viewer's user id (or `guest` for signed-out visitors).
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
  const isUpload = path.startsWith(UPLOADS_PREFIX) && path.length > UPLOADS_PREFIX.length;
  const isProtectedVideo = isUpload && path.startsWith(PROTECTED_VIDEO_PREFIX) && path.length > PROTECTED_VIDEO_PREFIX.length;
  return { path, token: url.searchParams.get(MEDIA_TOKEN_PARAM), isUpload, isProtectedVideo };
}

/** Whether a canonical path lives in the protected video directory. */
export function isProtectedVideoPath(path: string): boolean {
  return path.startsWith(PROTECTED_VIDEO_PREFIX) && path.length > PROTECTED_VIDEO_PREFIX.length;
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
  if (pa && pb) return pa.path === pb.path;
  return stripMediaToken(a) === stripMediaToken(b);
}
