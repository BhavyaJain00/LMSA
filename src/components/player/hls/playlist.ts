/**
 * Hand-written HLS playlist parser (RFC 8216) for the custom player's MSE
 * engine. Pure and DOM-free so it runs in unit tests.
 *
 * Supported: master playlists (EXT-X-STREAM-INF, EXT-X-MEDIA), media
 * playlists (EXTINF, EXT-X-TARGETDURATION, EXT-X-MEDIA-SEQUENCE,
 * EXT-X-PLAYLIST-TYPE, EXT-X-ENDLIST, EXT-X-MAP, EXT-X-BYTERANGE,
 * EXT-X-DISCONTINUITY, EXT-X-KEY detection). URIs are resolved against the
 * playlist URL; a same-origin child URI without its own query inherits the
 * parent's query string so path-scoped access tokens survive.
 */

export interface ByteRange {
  offset: number;
  length: number;
}

export interface HlsVariant {
  /** Position in the master playlist. */
  index: number;
  /** Absolute URL of the variant's media playlist. */
  uri: string;
  /** Peak bits per second. */
  bandwidth: number;
  averageBandwidth?: number;
  width?: number;
  height?: number;
  /** RFC 6381 codec list, e.g. `avc1.64001f,mp4a.40.2`. */
  codecs?: string;
  frameRate?: number;
  /** GROUP-ID of the EXT-X-MEDIA audio renditions this variant uses. */
  audioGroup?: string;
  /** NAME attribute (non-standard but common). */
  name?: string;
}

export interface HlsMediaRendition {
  type: "AUDIO" | "VIDEO" | "SUBTITLES" | "CLOSED-CAPTIONS";
  groupId: string;
  name: string;
  language?: string;
  /** Absolute URL; absent when the rendition is muxed into the variant. */
  uri?: string;
  isDefault: boolean;
  autoselect: boolean;
}

export interface MasterPlaylist {
  kind: "master";
  variants: HlsVariant[];
  media: HlsMediaRendition[];
  independentSegments: boolean;
}

export interface InitSegment {
  uri: string;
  byteRange?: ByteRange;
}

export interface MediaSegment {
  /** 0-based position in the playlist. */
  index: number;
  /** Media sequence number (EXT-X-MEDIA-SEQUENCE + index). */
  sequence: number;
  uri: string;
  /** EXTINF duration in seconds. */
  duration: number;
  /** Start time in seconds from the start of the playlist. */
  start: number;
  byteRange?: ByteRange;
  init?: InitSegment;
  /** EXT-X-DISCONTINUITY precedes this segment. */
  discontinuity: boolean;
}

export interface MediaPlaylist {
  kind: "media";
  version?: number;
  targetDuration: number;
  mediaSequence: number;
  playlistType?: "VOD" | "EVENT";
  endList: boolean;
  independentSegments: boolean;
  /** EXT-X-KEY with a method other than NONE: segments are encrypted. */
  encrypted: boolean;
  segments: MediaSegment[];
  totalDuration: number;
}

export class PlaylistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaylistParseError";
  }
}

/* ------------------------------------------------------------------ */
/* Attribute lists and URIs                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse an attribute list: `BANDWIDTH=800000,CODECS="avc1.4d401f,mp4a.40.2"`.
 * Quoted strings may contain commas; quotes are removed.
 */
export function parseAttributeList(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && (input[i] === " " || input[i] === ",")) i++;
    const eq = input.indexOf("=", i);
    if (eq === -1) break;
    const key = input.slice(i, eq).trim().toUpperCase();
    i = eq + 1;
    let value: string;
    if (input[i] === '"') {
      const close = input.indexOf('"', i + 1);
      const end = close === -1 ? n : close;
      value = input.slice(i + 1, end);
      i = close === -1 ? n : close + 1;
    } else {
      const comma = input.indexOf(",", i);
      const end = comma === -1 ? n : comma;
      value = input.slice(i, end).trim();
      i = end;
    }
    if (key) out[key] = value;
  }
  return out;
}

function parseResolution(value: string | undefined): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/i.exec(value?.trim() ?? "");
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** `length[@offset]`; without an offset the range continues where the previous one ended. */
export function parseByteRange(value: string, previousEnd: number | null): ByteRange | null {
  const m = /^\s*(\d+)(?:@(\d+))?\s*$/.exec(value);
  if (!m) return null;
  const length = Number(m[1]);
  const offset = m[2] !== undefined ? Number(m[2]) : previousEnd;
  if (offset === null || !Number.isSafeInteger(length) || !Number.isSafeInteger(offset) || length <= 0) return null;
  return { offset, length };
}

/**
 * Resolve a playlist URI against the playlist's own absolute URL. A
 * same-origin URI without a query string inherits the base URL's query
 * (CDN/path tokens), unless `inheritQuery` is false.
 */
export function resolveUri(uri: string, baseUrl: string, inheritQuery = true): string {
  const trimmed = uri.trim();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new PlaylistParseError("The playlist URL is not absolute.");
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, base);
  } catch {
    throw new PlaylistParseError(`Invalid URI in playlist: ${trimmed.slice(0, 80)}`);
  }
  if (inheritQuery && !resolved.search && !trimmed.includes("?") && base.search && resolved.origin === base.origin) {
    resolved.search = base.search;
  }
  return resolved.href;
}

function lines(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function tagValue(line: string, tag: string): string | null {
  return line.startsWith(`${tag}:`) ? line.slice(tag.length + 1) : null;
}

/** Whether the text is an HLS playlist at all. */
export function isPlaylist(text: string): boolean {
  return lines(text)[0] === "#EXTM3U";
}

/** Whether the playlist is a master (multivariant) playlist. */
export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(text);
}

/* ------------------------------------------------------------------ */
/* Master playlists                                                     */
/* ------------------------------------------------------------------ */

export function parseMasterPlaylist(text: string, baseUrl: string, opts: { inheritQuery?: boolean } = {}): MasterPlaylist {
  const all = lines(text);
  if (all[0] !== "#EXTM3U") throw new PlaylistParseError("Not an HLS playlist (missing #EXTM3U).");
  const inherit = opts.inheritQuery ?? true;
  const variants: HlsVariant[] = [];
  const media: HlsMediaRendition[] = [];
  let independentSegments = false;
  let pending: Record<string, string> | null = null;

  for (let i = 1; i < all.length; i++) {
    const line = all[i]!;
    if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
      independentSegments = true;
      continue;
    }
    const inf = tagValue(line, "#EXT-X-STREAM-INF");
    if (inf !== null) {
      pending = parseAttributeList(inf);
      continue;
    }
    const mediaTag = tagValue(line, "#EXT-X-MEDIA");
    if (mediaTag !== null) {
      const a = parseAttributeList(mediaTag);
      const type = a.TYPE?.toUpperCase();
      if ((type === "AUDIO" || type === "VIDEO" || type === "SUBTITLES" || type === "CLOSED-CAPTIONS") && a["GROUP-ID"]) {
        media.push({
          type,
          groupId: a["GROUP-ID"],
          name: a.NAME || a.LANGUAGE || a["GROUP-ID"],
          language: a.LANGUAGE || undefined,
          uri: a.URI ? resolveUri(a.URI, baseUrl, inherit) : undefined,
          isDefault: a.DEFAULT?.toUpperCase() === "YES",
          autoselect: a.AUTOSELECT?.toUpperCase() === "YES",
        });
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    // A URI line: belongs to the preceding EXT-X-STREAM-INF (stray URIs are ignored).
    if (!pending) continue;
    const bandwidth = positiveNumber(pending.BANDWIDTH);
    if (bandwidth) {
      const res = parseResolution(pending.RESOLUTION);
      const variant: HlsVariant = { index: variants.length, uri: resolveUri(line, baseUrl, inherit), bandwidth: Math.round(bandwidth) };
      const avg = positiveNumber(pending["AVERAGE-BANDWIDTH"]);
      if (avg) variant.averageBandwidth = Math.round(avg);
      if (res) {
        variant.width = res.width;
        variant.height = res.height;
      }
      if (pending.CODECS) variant.codecs = pending.CODECS.replace(/\s+/g, "");
      const fps = positiveNumber(pending["FRAME-RATE"]);
      if (fps) variant.frameRate = fps;
      if (pending.AUDIO) variant.audioGroup = pending.AUDIO;
      if (pending.NAME) variant.name = pending.NAME;
      variants.push(variant);
    }
    pending = null;
  }
  if (!variants.length) throw new PlaylistParseError("The master playlist lists no playable variants.");
  return { kind: "master", variants, media, independentSegments };
}

/* ------------------------------------------------------------------ */
/* Media playlists                                                      */
/* ------------------------------------------------------------------ */

export function parseMediaPlaylist(text: string, baseUrl: string, opts: { inheritQuery?: boolean } = {}): MediaPlaylist {
  const all = lines(text);
  if (all[0] !== "#EXTM3U") throw new PlaylistParseError("Not an HLS playlist (missing #EXTM3U).");
  if (isMasterPlaylist(text)) throw new PlaylistParseError("Expected a media playlist but got a master playlist.");
  const inherit = opts.inheritQuery ?? true;

  let version: number | undefined;
  let targetDuration = 0;
  let mediaSequence = 0;
  let playlistType: MediaPlaylist["playlistType"];
  let endList = false;
  let independentSegments = false;
  let encrypted = false;
  const segments: MediaSegment[] = [];

  let init: InitSegment | undefined;
  let duration: number | null = null;
  let byteRange: ByteRange | undefined;
  let discontinuity = false;
  let start = 0;
  /** End offset of the previous byte range per resource (for ranges without an explicit offset). */
  const rangeEnds = new Map<string, number>();
  let pendingRange: string | null = null;

  for (let i = 1; i < all.length; i++) {
    const line = all[i]!;
    if (line.startsWith("#")) {
      let v: string | null;
      if ((v = tagValue(line, "#EXTINF")) !== null) {
        const d = Number(v.split(",")[0]);
        if (!Number.isFinite(d) || d < 0) throw new PlaylistParseError("Invalid #EXTINF duration.");
        duration = d;
      } else if ((v = tagValue(line, "#EXT-X-TARGETDURATION")) !== null) {
        targetDuration = Number(v) || 0;
      } else if ((v = tagValue(line, "#EXT-X-MEDIA-SEQUENCE")) !== null) {
        mediaSequence = Number.isSafeInteger(Number(v)) ? Number(v) : 0;
      } else if ((v = tagValue(line, "#EXT-X-VERSION")) !== null) {
        version = Number(v) || undefined;
      } else if ((v = tagValue(line, "#EXT-X-PLAYLIST-TYPE")) !== null) {
        const t = v.trim().toUpperCase();
        if (t === "VOD" || t === "EVENT") playlistType = t;
      } else if (line === "#EXT-X-ENDLIST") {
        endList = true;
      } else if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
        independentSegments = true;
      } else if (line === "#EXT-X-DISCONTINUITY") {
        discontinuity = true;
      } else if ((v = tagValue(line, "#EXT-X-BYTERANGE")) !== null) {
        pendingRange = v;
      } else if ((v = tagValue(line, "#EXT-X-MAP")) !== null) {
        const a = parseAttributeList(v);
        if (!a.URI) throw new PlaylistParseError("#EXT-X-MAP without a URI.");
        const uri = resolveUri(a.URI, baseUrl, inherit);
        const range = a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : null;
        init = range ? { uri, byteRange: range } : { uri };
      } else if ((v = tagValue(line, "#EXT-X-KEY")) !== null) {
        const method = parseAttributeList(v).METHOD?.toUpperCase();
        if (method && method !== "NONE") encrypted = true;
      }
      continue;
    }
    // Segment URI
    if (duration === null) throw new PlaylistParseError("A segment URI is missing its #EXTINF.");
    const uri = resolveUri(line, baseUrl, inherit);
    if (pendingRange !== null) {
      const range = parseByteRange(pendingRange, rangeEnds.get(uri) ?? null);
      if (!range) throw new PlaylistParseError("Invalid #EXT-X-BYTERANGE.");
      byteRange = range;
      rangeEnds.set(uri, range.offset + range.length);
      pendingRange = null;
    }
    const segment: MediaSegment = {
      index: segments.length,
      sequence: mediaSequence + segments.length,
      uri,
      duration,
      start,
      discontinuity,
    };
    if (byteRange) segment.byteRange = byteRange;
    if (init) segment.init = init;
    segments.push(segment);
    start += duration;
    duration = null;
    byteRange = undefined;
    discontinuity = false;
  }
  if (!segments.length) throw new PlaylistParseError("The media playlist has no segments.");
  if (!targetDuration) targetDuration = Math.ceil(Math.max(...segments.map((s) => s.duration)));
  if (playlistType === "VOD") endList = true;
  return { kind: "media", version, targetDuration, mediaSequence, playlistType, endList, independentSegments, encrypted, segments, totalDuration: start };
}

/* ------------------------------------------------------------------ */
/* Codecs                                                               */
/* ------------------------------------------------------------------ */

/** Codec used when a variant does not declare CODECS (H.264 Main + AAC-LC, what the transcoder writes). */
export const DEFAULT_CODECS = "avc1.4d401f,mp4a.40.2";

export function splitCodecs(codecs: string | undefined): { video: string[]; audio: string[] } {
  const list = (codecs || DEFAULT_CODECS)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const video: string[] = [];
  const audio: string[] = [];
  for (const c of list) {
    if (/^(mp4a|ac-3|ec-3|opus|flac|fLaC|alac)/i.test(c)) audio.push(c);
    else video.push(c);
  }
  return { video, audio };
}

/** `video/mp4; codecs="…"` for a SourceBuffer. */
export function mp4MimeType(codecs: string[]): string {
  return `video/mp4; codecs="${codecs.join(",")}"`;
}

/** Display label for a variant: "1080p", falling back to its NAME or bitrate. */
export function variantLabel(v: Pick<HlsVariant, "height" | "name" | "bandwidth">): string {
  if (v.height) return `${v.height}p`;
  if (v.name) return v.name;
  return `${Math.round(v.bandwidth / 1000)} kbps`;
}
