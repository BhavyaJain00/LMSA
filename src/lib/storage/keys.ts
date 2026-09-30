import { UPLOADS_PREFIX, encodeMediaPath, isSafeUploadSegment, parseMediaSrc } from "@/lib/media/paths";

/**
 * Storage keys and the `/uploads/<key>` URLs that name them (pure, shared by
 * server code and tests).
 */

export const MAX_KEY_LENGTH = 1024;

/** A key the drivers accept: 1–32 safe segments (no dot-files, traversal, NTFS streams or device names). */
export function isSafeStorageKey(key: string): boolean {
  if (!key || key.length > MAX_KEY_LENGTH || key.startsWith("/") || key.endsWith("/")) return false;
  const parts = key.split("/");
  return parts.length <= 32 && parts.every(isSafeUploadSegment);
}

/** A key prefix ("videos/les_1/blk_2/hls/"): safe segments followed by a slash. */
export function isSafeStoragePrefix(prefix: string): boolean {
  return prefix.endsWith("/") && isSafeStorageKey(prefix.slice(0, -1));
}

export function assertSafeKey(key: string): string {
  if (!isSafeStorageKey(key)) throw new Error(`Unsafe storage key: ${JSON.stringify(key.slice(0, 80))}`);
  return key;
}

/** `/uploads/<key>` (encoded for use in a URL). */
export function uploadUrlForKey(key: string): string {
  return encodeMediaPath(`${UPLOADS_PREFIX}${key}`);
}

/** Storage key of an upload URL on this site (`/uploads/videos/a.mp4` → `videos/a.mp4`), or null. */
export function storageKeyFromUrl(src: string | undefined | null, siteOrigins: readonly string[] = []): string | null {
  if (!src) return null;
  const parsed = parseMediaSrc(src, siteOrigins);
  if (!parsed?.isUpload) return null;
  const key = parsed.path.slice(UPLOADS_PREFIX.length);
  return isSafeStorageKey(key) ? key : null;
}

/** Directory part of a key, with a trailing slash ("videos/a/b.mp4" → "videos/a/"). */
export function keyDirectory(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? "" : key.slice(0, i + 1);
}
