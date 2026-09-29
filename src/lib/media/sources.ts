import type { VideoSource } from "@/lib/types";

/**
 * Video renditions ("quality" options) for lesson videos.
 *
 * A video block's main `src` is always the default rendition; `sources`
 * adds alternatives (e.g. "1080p", "480p", "Data saver"). This module is
 * shared by the lesson editor, the block sanitizer and the player.
 */

export const MAX_VIDEO_SOURCES = 6;
export const MAX_SOURCE_LABEL = 32;
export const MIN_SOURCE_HEIGHT = 120;
export const MAX_SOURCE_HEIGHT = 4320;

/** "1080p" → 1080, "4K" → 2160, "HD" → 720; null when no height can be read. */
export function heightFromLabel(label: string): number | null {
  const text = label.trim().toLowerCase();
  const p = /(\d{3,4})\s*p\b/.exec(text);
  if (p) {
    const h = Number(p[1]);
    return h >= MIN_SOURCE_HEIGHT && h <= MAX_SOURCE_HEIGHT ? h : null;
  }
  if (/\b8k\b/.test(text)) return 4320;
  if (/\b4k\b|\buhd\b/.test(text)) return 2160;
  if (/\bfull\s*hd\b|\bfhd\b/.test(text)) return 1080;
  if (/\bhd\b/.test(text)) return 720;
  if (/\bsd\b/.test(text)) return 480;
  return null;
}

/** Default label for a rendition height: 1080 → "1080p". */
export function labelForHeight(height: number): string {
  return `${Math.round(height)}p`;
}

/**
 * Validate and normalize untrusted `sources` JSON from the lesson editor or
 * an import file. Invalid rows are reported through `onError` and dropped.
 * Returns undefined when there are no extra renditions.
 */
export function sanitizeVideoSources(
  raw: unknown,
  opts: {
    /** Returns an error message for an unacceptable URL (same rules as the main video src). */
    checkUrl: (url: string) => string | null;
    onError: (message: string) => void;
    /** The block's main src; a rendition identical to it is dropped. */
    mainSrc?: string;
  },
): VideoSource[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    opts.onError("Video qualities are malformed.");
    return undefined;
  }
  if (raw.length > MAX_VIDEO_SOURCES) opts.onError(`A video can have at most ${MAX_VIDEO_SOURCES} extra qualities.`);
  const out: VideoSource[] = [];
  const seenSrc = new Set<string>(opts.mainSrc ? [opts.mainSrc.trim()] : []);
  const seenLabel = new Set<string>();
  for (const item of raw.slice(0, MAX_VIDEO_SOURCES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const src = typeof r.src === "string" ? r.src.trim().slice(0, 2000) : "";
    const label = typeof r.label === "string" ? r.label.trim().replace(/\s+/g, " ").slice(0, MAX_SOURCE_LABEL) : "";
    if (!src && !label) continue;
    if (!src) {
      opts.onError(`Add a video file or URL for the "${label}" quality.`);
      continue;
    }
    const err = opts.checkUrl(src);
    if (err) {
      opts.onError(err);
      continue;
    }
    if (!label) {
      opts.onError("Every extra video quality needs a label, like 720p.");
      continue;
    }
    if (seenSrc.has(src)) continue;
    const key = label.toLowerCase();
    if (seenLabel.has(key)) {
      opts.onError(`Two video qualities are both labelled "${label}". Use a different label for each.`);
      continue;
    }
    let height: number | undefined;
    const rawHeight = typeof r.height === "number" ? r.height : typeof r.height === "string" && r.height.trim() ? Number(r.height) : NaN;
    if (Number.isFinite(rawHeight)) {
      const h = Math.round(rawHeight);
      if (h < MIN_SOURCE_HEIGHT || h > MAX_SOURCE_HEIGHT) {
        opts.onError(`The height of "${label}" must be between ${MIN_SOURCE_HEIGHT} and ${MAX_SOURCE_HEIGHT} pixels.`);
        continue;
      }
      height = h;
    } else {
      height = heightFromLabel(label) ?? undefined;
    }
    seenSrc.add(src);
    seenLabel.add(key);
    out.push(height ? { src, label, height } : { src, label });
  }
  return out.length ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* Player-side quality options                                         */
/* ------------------------------------------------------------------ */

export interface QualityOption {
  /** Stable id: "main" or "src:<index>". */
  id: string;
  src: string;
  label: string;
  height?: number;
}

export const AUTO_QUALITY = "auto";

/**
 * All renditions of a video, highest first. The main src comes first when
 * its height is unknown (it is usually the original upload).
 */
export function buildQualityOptions(src: string, sources: VideoSource[] | undefined, mainLabel?: string): QualityOption[] {
  const main: QualityOption = { id: "main", src, label: mainLabel?.trim() || "Original" };
  const labelHeight = mainLabel ? heightFromLabel(mainLabel) : null;
  if (labelHeight) main.height = labelHeight;
  const extra: QualityOption[] = [];
  (sources ?? []).forEach((s, i) => {
    if (!s || !s.src || s.src === src) return;
    extra.push({ id: `src:${i}`, src: s.src, label: s.label || (s.height ? labelForHeight(s.height) : `Quality ${i + 1}`), height: s.height ?? heightFromLabel(s.label) ?? undefined });
  });
  if (!extra.length) return [main];
  const known = extra.filter((o) => o.height).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const unknown = extra.filter((o) => !o.height);
  // The original keeps its place above renditions it is at least as large as.
  if (main.height) {
    const all = [...known, main].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return [...all, ...unknown];
  }
  return [main, ...known, ...unknown];
}

export interface AutoQualityEnv {
  /** `navigator.connection.effectiveType`: "slow-2g" | "2g" | "3g" | "4g". */
  effectiveType?: string;
  saveData?: boolean;
  /** Rendered player width in CSS pixels. */
  width: number;
  devicePixelRatio?: number;
}

/**
 * Pick a rendition for "Auto": respects Data Saver and slow connections,
 * otherwise the smallest rendition that still fills the player sharply.
 * Renditions without a known height are only chosen when nothing else fits.
 */
export function pickAutoQuality(options: QualityOption[], env: AutoQualityEnv): QualityOption {
  const first = options[0]!;
  if (options.length === 1) return first;
  const sized = options.filter((o) => o.height).sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  if (!sized.length) return first;
  const lowest = sized[0]!;
  const type = env.effectiveType ?? "";
  if (env.saveData || type === "slow-2g" || type === "2g") return lowest;

  const dpr = Math.min(Math.max(env.devicePixelRatio ?? 1, 1), 2);
  const neededHeight = Math.max(1, (env.width * 9) / 16) * dpr;
  const cap = type === "3g" ? 480 : Infinity;
  const affordable = sized.filter((o) => (o.height ?? 0) <= cap);
  const pool = affordable.length ? affordable : [lowest];
  const fitting = pool.find((o) => (o.height ?? 0) >= neededHeight * 0.9);
  if (fitting) return fitting;
  // Nothing is big enough: take the largest affordable one, or the original when it is not capped.
  const largest = pool[pool.length - 1]!;
  if (cap === Infinity && !first.height && first.id === "main") return first;
  return largest;
}
