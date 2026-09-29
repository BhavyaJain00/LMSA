"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mediaTokenExpiry, parseMediaSrc, stripMediaToken } from "@/lib/media/paths";

/**
 * Keeps the URL of a protected lesson video playable.
 *
 * Uploads under `/uploads/videos/` may require a signed, expiring token
 * (Settings → Video → Protect uploads). The server pre-signs URLs when it
 * renders a lesson; this hook
 *  - requests a signed URL for protected srcs rendered without a token
 *    (course promo videos, class recordings, editor previews),
 *  - refreshes the URL shortly before the token expires,
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
  /** Human readable reason when status is "denied" or "error". */
  message: string | null;
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
  error?: string;
  player?: MediaPlayerConfig;
}

type SignResult = { ok: true; url: string; config: MediaPlayerConfig | null } | { ok: false; denied: boolean; message: string };

/** Refresh this many seconds before the token expires. */
const REFRESH_LEAD_SECONDS = 45;
const MIN_REFRESH_DELAY_MS = 5_000;

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
    if (res.ok && body?.ok && body.src) return { ok: true, url: body.src, config: body.player ?? null };
    const denied = res.status === 401 || res.status === 403;
    const fallback =
      res.status === 401
        ? "Sign in to watch this video."
        : res.status === 403
          ? "You don't have access to this video."
          : res.status === 404
            ? "This video could not be found."
            : res.status === 429
              ? "Too many requests. Please wait a moment and try again."
              : "The video could not be loaded.";
    return { ok: false, denied, message: body?.error || fallback };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return { ok: false, denied: false, message: "" };
    return { ok: false, denied: false, message: "Check your connection and try again." };
  }
}

interface Resolved {
  /** The src this URL was resolved for. */
  forSrc: string;
  url: string | null;
  status: MediaSourceStatus;
  message: string | null;
}

export function useMediaSource(src: string, lessonId?: string): MediaSourceState {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [config, setConfig] = useState<MediaPlayerConfig | null>(null);
  const requestId = useRef(0);
  const srcRef = useRef(src);
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const parsed = src ? parseMediaSrc(src, origin ? [origin] : []) : null;
  const isProtected = !!parsed?.isProtectedVideo;
  const needsInitialSign = isProtected && !parsed?.token;

  // What the element should play right now.
  let url: string | null;
  let status: MediaSourceStatus;
  let message: string | null = null;
  if (resolved && resolved.forSrc === src) {
    url = resolved.url;
    status = resolved.status;
    message = resolved.message;
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
        setResolved({ forSrc, url: result.url, status: "ready", message: null });
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
    const delay = Math.max(MIN_REFRESH_DELAY_MS, (expires - REFRESH_LEAD_SECONDS) * 1000 - Date.now());
    const timer = window.setTimeout(() => void sign(src), delay);
    return () => window.clearTimeout(timer);
  }, [url, isProtected, src, sign]);

  const refresh = useCallback(async () => {
    if (!isProtected) return null;
    return sign(srcRef.current);
  }, [isProtected, sign]);

  return { url, status, message, isProtected, config, refresh };
}
