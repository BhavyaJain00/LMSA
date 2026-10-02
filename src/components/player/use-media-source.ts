"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mediaTokenExpiry, parseMediaSrc, stripMediaToken } from "@/lib/media/paths";

/**
 * Keeps the URL of a protected lesson video playable.
 *
 * Uploads under `/uploads/videos/` may require a signed, expiring token
 * (Settings → Video → Protect uploads). The server pre-signs URLs when it
 * renders a lesson; this hook
 *  - requests a signed URL for protected srcs rendered without a token
 *    (course promo videos, class recordings, editor previews),
 *  - refreshes the URL shortly before the token expires, scheduled from the
 *    token lifetime the server reports rather than the browser clock (a
 *    clock that runs ahead must not cause a reload loop),
 *  - re-signs on demand when a request fails mid-playback (see `refresh`).
 * Everything else (external URLs, other uploads) is passed through as is.
 */

export interface MediaPlayerConfig {
  watermark: { text: string; opacity: number } | null;
  seekThumbnails: boolean;
  autoplayNext: boolean;
}

export type MediaSourceStatus = "direct" | "resolving" | "ready" | "denied" | "error";

export interface MediaSourceState {
  /** URL for the <video> element; null while a signed URL is being fetched or access was denied. */
  url: string | null;
  status: MediaSourceStatus;
  /** Human readable reason when status is "denied" or "error" (English, from the server when it sent one). */
  message: string | null;
  /** Why signing failed, for a message in the interface language (null while fine). */
  reason: MediaFailureReason | null;
  /** The src is an upload that may need a signed token. */
  isProtected: boolean;
  /** Player options sent by the server with a signed URL (viewer watermark etc.). */
  config: MediaPlayerConfig | null;
  /** Fetch a fresh signed URL now (e.g. after a 403 mid-playback). Resolves to the new URL, or null on failure. */
  refresh: () => Promise<string | null>;
}

interface SignResponse {
  ok: boolean;
  src?: string;
  expiresAt?: number | null;
  ttlSeconds?: number | null;
  error?: string;
  player?: MediaPlayerConfig;
}

/** Why a signed URL could not be obtained. */
export type MediaFailureReason = "signIn" | "forbidden" | "notFound" | "rateLimited" | "unavailable" | "failed" | "network";

type SignResult =
  | { ok: true; url: string; ttlSeconds: number | null; config: MediaPlayerConfig | null }
  | { ok: false; denied: boolean; message: string; reason: MediaFailureReason };

/** Refresh this many seconds before the token expires. */
const REFRESH_LEAD_SECONDS = 45;
const MIN_REFRESH_DELAY_MS = 5_000;

/**
 * When to renew a signed URL, in ms from now.
 *  - URLs fetched from `/api/media/sign` carry their lifetime: renew
 *    `ttl - 45 s` after they arrived, never sooner than half the lifetime,
 *    whatever the browser clock says.
 *  - Pre-signed URLs from the page: the expiry by the browser clock, but no
 *    later than one lifetime from now (`ttlHint`) in case that clock is late.
 * A clock that runs ahead can only cause one early renewal, never a loop.
 */
export function refreshDelayMs(opts: { expires: number; now: number; issued?: { receivedAt: number; ttlSeconds: number } | null; ttlHint?: number | null }): number {
  const { expires, now, issued, ttlHint } = opts;
  if (issued && issued.ttlSeconds > 0) {
    const lifetime = issued.ttlSeconds * 1000;
    const after = Math.max(lifetime - REFRESH_LEAD_SECONDS * 1000, lifetime / 2);
    return Math.max(MIN_REFRESH_DELAY_MS, issued.receivedAt + after - now);
  }
  let delay = (expires - REFRESH_LEAD_SECONDS) * 1000 - now;
  if (ttlHint && ttlHint > 0) delay = Math.min(delay, Math.max(ttlHint - REFRESH_LEAD_SECONDS, ttlHint / 2) * 1000);
  return Math.max(MIN_REFRESH_DELAY_MS, delay);
}

const subscribeNothing = () => () => undefined;
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

async function requestSignedUrl(src: string, lessonId: string | undefined, signal?: AbortSignal): Promise<SignResult> {
  const params = new URLSearchParams({ src: stripMediaToken(src) });
  if (lessonId) params.set("lesson", lessonId);
  try {
    const res = await fetch(`/api/media/sign?${params.toString()}`, { credentials: "same-origin", cache: "no-store", signal });
    let body: SignResponse | null = null;
    try {
      body = (await res.json()) as SignResponse;
    } catch {
      body = null;
    }
    if (res.ok && body?.ok && body.src) {
      const ttl = typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds) && body.ttlSeconds > 0 ? body.ttlSeconds : null;
      return { ok: true, url: body.src, ttlSeconds: ttl, config: body.player ?? null };
    }
    const denied = res.status === 401 || res.status === 403;
    const reason: MediaFailureReason =
      res.status === 401
        ? "signIn"
        : res.status === 403
          ? "forbidden"
          : res.status === 404
            ? "notFound"
            : res.status === 429
              ? "rateLimited"
              : res.status === 503
                ? "unavailable"
                : "failed";
    const fallback =
      res.status === 401
        ? "Sign in to watch this video."
        : res.status === 403
          ? "You don't have access to this video."
          : res.status === 404
            ? "This video could not be found."
            : res.status === 429
              ? "Too many requests. Please wait a moment and try again."
              : res.status === 503
                ? "This video is unavailable right now. Please try again later."
                : "The video could not be loaded.";
    return { ok: false, denied, message: body?.error || fallback, reason };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return { ok: false, denied: false, message: "", reason: "network" };
    return { ok: false, denied: false, message: "Check your connection and try again.", reason: "network" };
  }
}

interface Resolved {
  /** The src this URL was resolved for. */
  forSrc: string;
  url: string | null;
  status: MediaSourceStatus;
  message: string | null;
  reason: MediaFailureReason | null;
}

/**
 * @param lessonId scopes signing requests to a lesson.
 * @param ttlHint lifetime (seconds) of pre-signed URLs, from the server's settings.
 */
export function useMediaSource(src: string, lessonId?: string, ttlHint?: number | null): MediaSourceState {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [config, setConfig] = useState<MediaPlayerConfig | null>(null);
  const requestId = useRef(0);
  const srcRef = useRef(src);
  /** The last URL fetched from the sign endpoint, with when it arrived and its lifetime. */
  const issuedRef = useRef<{ url: string; receivedAt: number; ttlSeconds: number } | null>(null);
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  // "" while hydrating (like the server render), the real origin afterwards.
  const origin = useSyncExternalStore(subscribeNothing, clientOrigin, serverOrigin);
  const parsed = src ? parseMediaSrc(src, origin ? [origin] : []) : null;
  const isProtected = !!parsed?.isProtectedVideo;
  const needsInitialSign = isProtected && !parsed?.token;

  // What the element should play right now.
  let url: string | null;
  let status: MediaSourceStatus;
  let message: string | null = null;
  let reason: MediaFailureReason | null = null;
  if (resolved && resolved.forSrc === src) {
    url = resolved.url;
    status = resolved.status;
    message = resolved.message;
    reason = resolved.reason;
  } else if (!src) {
    // No rendition chosen yet (the player picks one after measuring itself).
    url = null;
    status = "resolving";
  } else if (needsInitialSign) {
    url = null;
    status = "resolving";
  } else {
    url = src;
    status = "direct";
  }

  const sign = useCallback(
    async (forSrc: string): Promise<string | null> => {
      const id = ++requestId.current;
      const result = await requestSignedUrl(forSrc, lessonId);
      // A newer request (or a different source) superseded this one.
      if (id !== requestId.current || srcRef.current !== forSrc) return null;
      if (result.ok) {
        issuedRef.current = result.ttlSeconds ? { url: result.url, receivedAt: Date.now(), ttlSeconds: result.ttlSeconds } : null;
        setResolved({ forSrc, url: result.url, status: "ready", message: null, reason: null });
        if (result.config) setConfig(result.config);
        return result.url;
      }
      if (!result.message) return null;
      setResolved((prev) => ({
        forSrc,
        // Keep playing the old URL on a transient failure; stop on a definite denial.
        url: result.denied ? null : prev?.forSrc === forSrc ? prev.url : null,
        status: result.denied ? "denied" : "error",
        message: result.message,
        reason: result.reason,
      }));
      return null;
    },
    [lessonId],
  );

  // Protected upload without a token: ask the server for one.
  useEffect(() => {
    if (!needsInitialSign) return;
    if (resolved && resolved.forSrc === src) return;
    const timer = window.setTimeout(() => void sign(src), 0);
    return () => window.clearTimeout(timer);
  }, [needsInitialSign, resolved, src, sign]);

  // Refresh shortly before the current token expires.
  useEffect(() => {
    if (!url || !isProtected) return;
    const expires = mediaTokenExpiry(url);
    if (!expires) return;
    const issued = issuedRef.current?.url === url ? issuedRef.current : null;
    const delay = refreshDelayMs({ expires, now: Date.now(), issued, ttlHint });
    const timer = window.setTimeout(() => void sign(src), delay);
    return () => window.clearTimeout(timer);
  }, [url, isProtected, src, sign, ttlHint]);

  const refresh = useCallback(async () => {
    if (!isProtected) return null;
    return sign(srcRef.current);
  }, [isProtected, sign]);

  return { url, status, message, reason, isProtected, config, refresh };
}
