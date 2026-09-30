import { canonicalMediaPath } from "./paths";

/**
 * HLS playlist helpers (pure; shared by the transcoder, the file route and
 * tests).
 *
 *  - `rewritePlaylist` gives every child URI of a playlist its own signed
 *    URL, so protected streams keep working with per-file tokens.
 *  - `buildMasterPlaylist` writes the multivariant playlist with
 *    BANDWIDTH/AVERAGE-BANDWIDTH/RESOLUTION/CODECS for each rendition.
 *  - `parseMediaSegments` + `measureBandwidth` compute real peak and average
 *    bit rates from the produced segments.
 */

export const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";
/** Largest playlist the file route will rewrite in memory. */
export const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

const PLACEHOLDER_ORIGIN = "http://media.invalid";

/** Extensions produced by the HLS packager and their content types. */
export const HLS_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".m3u8": HLS_MIME_TYPE,
  ".m4s": "video/iso.segment",
  ".ts": "video/mp2t",
};

export function isPlaylistPath(p: string): boolean {
  return /\.m3u8$/i.test(p.split("?")[0] ?? "");
}

function directoryOf(p: string): string {
  return p.slice(0, p.lastIndexOf("/") + 1);
}

/**
 * Resolve a URI found in a playlist against the playlist's own path. Returns
 * the canonical path when it is a same-site relative/root-relative reference
 * inside the playlist's directory tree, and null for anything else (absolute
 * URLs to other hosts, data: URIs, references that climb out of the folder).
 */
export function resolvePlaylistUri(uri: string, playlistPath: string): string | null {
  const value = uri.trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(value, new URL(playlistPath, PLACEHOLDER_ORIGIN));
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const resolved = canonicalMediaPath(url.pathname);
  if (!resolved) return null;
  const dir = directoryOf(playlistPath);
  return resolved.startsWith(dir) && resolved.length > dir.length ? resolved : null;
}

/**
 * Rewrite every URI of a playlist through `sign`: URI lines and `URI="…"`
 * attributes (EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, …). `sign`
 * receives the canonical child path and returns the URL to write, or null to
 * leave the URI as it is. Line endings are normalized to "\n".
 */
export function rewritePlaylist(text: string, playlistPath: string, sign: (childPath: string) => string | null): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const signUri = (uri: string): string => {
    const child = resolvePlaylistUri(uri, playlistPath);
    if (!child) return uri;
    return sign(child) ?? uri;
  };
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (!trimmed.startsWith("#EXT")) return line;
        return line.replace(/URI="([^"]*)"/g, (_, uri: string) => `URI="${signUri(uri)}"`);
      }
      return signUri(trimmed);
    })
    .join("\n");
}

export interface MediaSegment {
  uri: string;
  /** Seconds (EXTINF). */
  duration: number;
}

export interface MediaPlaylistInfo {
  segments: MediaSegment[];
  /** URI of the fMP4 initialization segment (EXT-X-MAP), if any. */
  initUri: string | null;
  targetDuration: number | null;
  totalDuration: number;
  endList: boolean;
}

/** Parse the segments of a media playlist. */
export function parseMediaSegments(text: string): MediaPlaylistInfo {
  const segments: MediaSegment[] = [];
  let pending: number | null = null;
  let initUri: string | null = null;
  let targetDuration: number | null = null;
  let endList = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const value = Number.parseFloat(line.slice(8).split(",")[0] ?? "");
      pending = Number.isFinite(value) && value >= 0 ? value : 0;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      initUri = /URI="([^"]*)"/.exec(line)?.[1] ?? null;
    } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const t = Number(line.slice(22));
      targetDuration = Number.isFinite(t) ? t : null;
    } else if (line === "#EXT-X-ENDLIST") {
      endList = true;
    } else if (!line.startsWith("#") && pending !== null) {
      segments.push({ uri: line, duration: pending });
      pending = null;
    }
  }
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  return { segments, initUri, targetDuration, totalDuration, endList };
}

/** Total duration (seconds) of a playlist's segments; 0 for a multivariant playlist. */
export function playlistDuration(text: string): number {
  return parseMediaSegments(text).totalDuration;
}

/**
 * Peak and average bit rates (bits per second) of a rendition from its
 * segment sizes. Very short segments (the tail of a video) are left out of
 * the peak, as they would overstate it.
 */
export function measureBandwidth(segments: { duration: number; bytes: number }[], initBytes = 0): { peak: number; average: number } {
  const usable = segments.filter((s) => s.duration > 0);
  if (!usable.length) return { peak: 0, average: 0 };
  const totalBits = usable.reduce((sum, s) => sum + s.bytes * 8, initBytes * 8);
  const totalDuration = usable.reduce((sum, s) => sum + s.duration, 0);
  const longest = Math.max(...usable.map((s) => s.duration));
  const peakCandidates = usable.filter((s) => s.duration >= Math.min(1, longest / 2));
  const peak = Math.max(...(peakCandidates.length ? peakCandidates : usable).map((s) => (s.bytes * 8) / s.duration));
  return { peak: Math.ceil(peak), average: Math.ceil(totalBits / totalDuration) };
}

export interface HlsVariant {
  /** Relative URI of the media playlist, e.g. "720p/index.m3u8". */
  uri: string;
  width: number;
  height: number;
  /** Peak bits per second. */
  bandwidth: number;
  averageBandwidth?: number;
  /** e.g. "avc1.64001f,mp4a.40.2" */
  codecs: string;
  frameRate?: number;
}

/** Multivariant (master) playlist, highest rendition first. */
export function buildMasterPlaylist(variants: HlsVariant[]): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const v of [...variants].sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)) {
    const attrs = [`BANDWIDTH=${Math.max(1, Math.round(v.bandwidth))}`];
    if (v.averageBandwidth) attrs.push(`AVERAGE-BANDWIDTH=${Math.max(1, Math.round(v.averageBandwidth))}`);
    attrs.push(`RESOLUTION=${v.width}x${v.height}`);
    attrs.push(`CODECS="${v.codecs}"`);
    if (v.frameRate && Number.isFinite(v.frameRate)) attrs.push(`FRAME-RATE=${v.frameRate.toFixed(3)}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`, v.uri);
  }
  return `${lines.join("\n")}\n`;
}

/** Renditions listed in a multivariant playlist (height and peak BANDWIDTH), highest first. */
export function parseMasterRenditions(text: string): { height: number; bandwidth: number; uri: string }[] {
  const out: { height: number; bandwidth: number; uri: string }[] = [];
  let pending: { height: number; bandwidth: number } | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = line.slice(18);
      const bandwidth = Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(attrs)?.[1] ?? NaN);
      const height = Number(/(?:^|,)RESOLUTION=\d+x(\d+)/.exec(attrs)?.[1] ?? NaN);
      pending = Number.isFinite(bandwidth) && Number.isFinite(height) ? { height, bandwidth } : null;
    } else if (!line.startsWith("#")) {
      if (pending) out.push({ ...pending, uri: line });
      pending = null;
    }
  }
  return out.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}
