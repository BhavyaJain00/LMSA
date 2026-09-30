import { mp4MimeType } from "./playlist";

/**
 * How this browser can play an HLS stream:
 *  - "mse": through the hand-written engine (Media Source Extensions);
 *  - "native": the browser plays `.m3u8` itself (Safari, iOS);
 *  - "none": neither — the player uses the progressive MP4.
 */
export type HlsSupport = "mse" | "native" | "none";

let cached: HlsSupport | null = null;

export function mediaSourceCtor(): typeof MediaSource | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as Window & { MediaSource?: typeof MediaSource }).MediaSource;
  return ctor && typeof ctor.isTypeSupported === "function" ? ctor : null;
}

/** Detected once per page (stable, as `useSyncExternalStore` requires). */
export function detectHlsSupport(): HlsSupport {
  if (cached) return cached;
  if (typeof window === "undefined" || typeof document === "undefined") return "none";
  const ms = mediaSourceCtor();
  if (ms && ms.isTypeSupported(mp4MimeType(["avc1.42E01E", "mp4a.40.2"]))) {
    cached = "mse";
  } else {
    const probe = document.createElement("video");
    cached = probe.canPlayType("application/vnd.apple.mpegurl") ? "native" : "none";
  }
  return cached;
}
