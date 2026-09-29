"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Seek-bar preview frames generated in the browser.
 *
 * A hidden second <video> (same source, muted, preload="metadata") seeks to
 * the hovered time and the frame is drawn onto a small canvas. Frames are
 * cached per 5-second bucket; seeks are serialized and throttled, and only
 * the most recent request is honoured (last request wins). If the frame
 * cannot be read (a cross-origin video without CORS taints the canvas and
 * throws a SecurityError, or the source fails to load) the preview falls
 * back to the time-only tooltip.
 */

export const THUMB_BUCKET_SECONDS = 5;
const THUMB_WIDTH = 160;
const MAX_CACHED_FRAMES = 240;
const MIN_SEEK_INTERVAL_MS = 90;

export interface ThumbnailFrame {
  bucket: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export type ThumbnailStatus = "idle" | "loading" | "ready" | "unavailable";

export interface SeekThumbnails {
  /** Attach to the hidden <video> element (rendered only while `active`). */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The hidden video should be mounted (becomes true on the first hover). */
  active: boolean;
  status: ThumbnailStatus;
  /** Most recent frame drawn (may lag behind the hovered time while seeking). */
  frame: ThumbnailFrame | null;
  /** Ask for the frame at `time` (seconds). */
  request: (time: number) => void;
  /** crossOrigin attribute for the hidden video. */
  crossOrigin: "anonymous" | undefined;
}

export function bucketOf(time: number): number {
  return Math.max(0, Math.floor(time / THUMB_BUCKET_SECONDS));
}

function isCrossOrigin(src: string | null): boolean {
  if (!src || typeof window === "undefined") return false;
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isSecurityError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "SecurityError";
}

export function useSeekThumbnails({ src, enabled }: { src: string | null; enabled: boolean }): SeekThumbnails {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cache = useRef(new Map<number, ThumbnailFrame>());
  const pending = useRef<number | null>(null);
  const inFlight = useRef<number | null>(null);
  const lastSeekAt = useRef(0);
  const throttleTimer = useRef<number | null>(null);
  const probed = useRef(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<ThumbnailStatus>("idle");
  const [frame, setFrame] = useState<ThumbnailFrame | null>(null);

  const usable = enabled && !!src && status !== "unavailable";

  const kick = useCallback(() => {
    const video = videoRef.current;
    const bucket = pending.current;
    if (!video || bucket === null || inFlight.current !== null) return;
    if (video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const wait = lastSeekAt.current + MIN_SEEK_INTERVAL_MS - performance.now();
    if (wait > 0) {
      if (throttleTimer.current === null) {
        throttleTimer.current = window.setTimeout(() => {
          throttleTimer.current = null;
          kick();
        }, wait);
      }
      return;
    }
    const cached = cache.current.get(bucket);
    if (cached) {
      pending.current = null;
      setFrame(cached);
      return;
    }
    inFlight.current = bucket;
    lastSeekAt.current = performance.now();
    const target = Math.min(bucket * THUMB_BUCKET_SECONDS + THUMB_BUCKET_SECONDS / 2, Math.max(0, video.duration - 0.1));
    try {
      video.currentTime = target;
    } catch {
      inFlight.current = null;
    }
  }, []);

  // Wire the hidden video's events.
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;

    const draw = () => {
      const bucket = inFlight.current;
      inFlight.current = null;
      if (bucket === null) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        kick();
        return;
      }
      const width = THUMB_WIDTH;
      const height = Math.max(1, Math.round((THUMB_WIDTH * vh) / vw));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setStatus("unavailable");
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, width, height);
        if (!probed.current) {
          // Reading one pixel throws a SecurityError when the frame came from a cross-origin source without CORS.
          ctx.getImageData(0, 0, 1, 1);
          probed.current = true;
        }
      } catch (err) {
        if (isSecurityError(err)) {
          setStatus("unavailable");
          return;
        }
        // Frame not decodable (e.g. InvalidStateError): drop this request and serve the next one.
        if (pending.current === bucket) pending.current = null;
        kick();
        return;
      }
      const entry: ThumbnailFrame = { bucket, canvas, width, height };
      const map = cache.current;
      map.set(bucket, entry);
      if (map.size > MAX_CACHED_FRAMES) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      setStatus("ready");
      if (pending.current === bucket) {
        pending.current = null;
        setFrame(entry);
      } else {
        kick();
      }
    };
    const onMeta = () => {
      setStatus((s) => (s === "unavailable" ? s : "loading"));
      kick();
    };
    const onError = () => {
      inFlight.current = null;
      setStatus("unavailable");
    };

    video.addEventListener("seeked", draw);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onError);
    if (video.readyState >= 1) onMeta();
    return () => {
      video.removeEventListener("seeked", draw);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onError);
    };
  }, [active, kick]);

  // Signed URLs are refreshed over time: point the hidden video at the current one when idle.
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video || !src) return;
    if (video.getAttribute("src") === src) return;
    if (inFlight.current !== null) inFlight.current = null;
    video.src = src;
  }, [active, src]);

  useEffect(
    () => () => {
      if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current);
      const video = videoRef.current;
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
    },
    [],
  );

  const request = useCallback(
    (time: number) => {
      if (!usable || !Number.isFinite(time)) return;
      const bucket = bucketOf(time);
      const cached = cache.current.get(bucket);
      if (cached) {
        pending.current = null;
        setFrame(cached);
        return;
      }
      pending.current = bucket;
      if (!active) {
        setActive(true);
        setStatus("loading");
        return;
      }
      kick();
    },
    [usable, active, kick],
  );

  return {
    videoRef,
    active: active && usable,
    status: enabled ? status : "idle",
    frame: usable ? frame : null,
    request,
    crossOrigin: isCrossOrigin(src) ? "anonymous" : undefined,
  };
}
