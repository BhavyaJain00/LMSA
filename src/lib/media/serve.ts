import "server-only";
import { rewritePlaylist } from "./hls";
import { withMediaToken } from "./paths";
import { issueMediaToken, nowSeconds } from "./token";

/**
 * Helpers for serving HLS streams through `/uploads/[...path]`.
 *
 * A protected stream is opened with one signed master-playlist URL. When the
 * file route serves a playlist whose own token was verified, it gives every
 * child URI (media playlists, init and media segments) a fresh token for
 * the same viewer, so the whole stream plays with per-file signatures and a
 * copied playlist stops working for anyone else — and for everyone once the
 * tokens expire.
 */

/** A file that belongs to a generated HLS stream (`…/hls/<version>/…`). */
export function isHlsPart(key: string): boolean {
  return /(^|\/)hls\/[^/]+\//i.test(key);
}

/** Rewrite a playlist so each child URI carries a token for `subject` valid for `ttlSeconds`. */
export function signPlaylist(text: string, playlistPath: string, subject: string, ttlSeconds: number, now = nowSeconds()): string {
  const cache = new Map<string, string>();
  return rewritePlaylist(text, playlistPath, (child) => {
    const known = cache.get(child);
    if (known) return known;
    const { token } = issueMediaToken(child, subject, ttlSeconds, now);
    const url = withMediaToken(child, token);
    cache.set(child, url);
    return url;
  });
}
