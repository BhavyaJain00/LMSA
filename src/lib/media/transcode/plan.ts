/**
 * Planning an HLS conversion (pure; unit tested).
 *
 * One ffmpeg run decodes the source once, splits the picture and encodes
 * every rendition (H.264 + AAC) into its own fMP4/CMAF HLS playlist with
 * aligned 6-second segments (keyframes forced on segment boundaries, scene-cut
 * keyframes off), so players can switch renditions at any segment boundary.
 * The master playlist is written afterwards from the measured bit rates.
 */

/** Rendition heights an admin can choose from (Settings → Storage & video). */
export const SUPPORTED_RENDITIONS = [1080, 720, 480, 360] as const;
export const SEGMENT_SECONDS = 6;
export const X264_PRESET = "veryfast";

export interface RenditionProfile {
  height: number;
  crf: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioKbps: number;
  profile: "high" | "main";
}

const PROFILES: RenditionProfile[] = [
  { height: 1080, crf: 21, maxrateKbps: 5000, bufsizeKbps: 10000, audioKbps: 128, profile: "high" },
  { height: 720, crf: 22, maxrateKbps: 2800, bufsizeKbps: 5600, audioKbps: 128, profile: "high" },
  { height: 480, crf: 23, maxrateKbps: 1400, bufsizeKbps: 2800, audioKbps: 96, profile: "main" },
  { height: 360, crf: 24, maxrateKbps: 800, bufsizeKbps: 1600, audioKbps: 96, profile: "main" },
  { height: 240, crf: 25, maxrateKbps: 450, bufsizeKbps: 900, audioKbps: 64, profile: "main" },
];

/** Encoding settings for a height (the nearest profile at or below it, scaled for odd sizes). */
export function profileFor(height: number): RenditionProfile {
  const exact = PROFILES.find((p) => p.height === height);
  if (exact) return exact;
  const below = PROFILES.find((p) => p.height <= height) ?? PROFILES[PROFILES.length - 1]!;
  const scale = Math.min(1.6, Math.max(0.5, height / below.height));
  return {
    ...below,
    height,
    maxrateKbps: Math.round(below.maxrateKbps * scale),
    bufsizeKbps: Math.round(below.bufsizeKbps * scale),
  };
}

/** Sanitize configured rendition heights: supported values only, unique, highest first, at least one. */
export function normalizeRenditions(raw: readonly unknown[] | undefined, fallback: readonly number[] = [1080, 720, 480]): number[] {
  const allowed = new Set<number>(SUPPORTED_RENDITIONS);
  const out = Array.from(new Set((raw ?? []).map((v) => Number(v)).filter((v) => allowed.has(v)))).sort((a, b) => b - a);
  return out.length ? out : [...fallback];
}

function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

/**
 * Heights to produce for a source: the configured ones that do not upscale
 * the video. A source smaller than every configured height gets one
 * rendition at its own (even) height.
 */
export function renditionLadder(source: { height: number }, configured: readonly number[]): number[] {
  const heights = normalizeRenditions(configured);
  const fits = heights.filter((h) => h <= source.height);
  if (fits.length) return fits;
  const own = even(source.height);
  return own >= 2 ? [own] : [];
}

/** Output width for a target height, keeping the display aspect ratio (even, as H.264 requires). */
export function scaledWidth(source: { width: number; height: number }, height: number): number {
  if (!(source.width > 0) || !(source.height > 0)) return even((height * 16) / 9);
  return Math.max(2, even((source.width * height) / source.height));
}

/* ------------------------------------------------------------------ */
/* H.264 levels and RFC 6381 codec strings                              */
/* ------------------------------------------------------------------ */

/** [level_idc, max macroblocks per second, max frame size in macroblocks] (ITU-T H.264 Table A-1). */
const LEVELS: [number, number, number][] = [
  [30, 40_500, 1_620],
  [31, 108_000, 3_600],
  [32, 216_000, 5_120],
  [40, 245_760, 8_192],
  [41, 245_760, 8_192],
  [42, 522_240, 8_704],
  [50, 589_824, 22_080],
  [51, 983_040, 36_864],
  [52, 2_073_600, 36_864],
];

/** Smallest H.264 level (level_idc, e.g. 31 for 3.1) that fits a frame size and rate. */
export function h264Level(width: number, height: number, fps: number): number {
  const frameMbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = frameMbs * Math.max(1, fps || 30);
  // 4.0 is skipped in favour of 4.1: same limits, higher bit rate ceiling and more widely targeted.
  for (const [level, maxMbps, maxFs] of LEVELS) {
    if (level === 40) continue;
    if (frameMbs <= maxFs && rate <= maxMbps) return level;
  }
  return 52;
}

/** e.g. avc1.64001f (High 3.1), avc1.4d401e (Main 3.0), plus mp4a.40.2 (AAC-LC) when there is audio. */
export function codecString(profile: "high" | "main", levelIdc: number, hasAudio: boolean): string {
  const profileHex = profile === "high" ? "6400" : "4d40";
  const video = `avc1.${profileHex}${levelIdc.toString(16).padStart(2, "0")}`;
  return hasAudio ? `${video},mp4a.40.2` : video;
}

/* ------------------------------------------------------------------ */
/* ffprobe                                                              */
/* ------------------------------------------------------------------ */

export interface ProbeInfo {
  /** Seconds (0 when unknown). */
  duration: number;
  /** Display size (rotation applied). */
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  sizeBytes: number | null;
}

function parseRate(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [num, den] = value.split("/").map(Number);
  if (!num || !Number.isFinite(num)) return 0;
  const rate = den ? num / den : num;
  return Number.isFinite(rate) && rate > 0 && rate < 1000 ? rate : 0;
}

function numberOf(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Parse `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbe(json: unknown): ProbeInfo {
  const root = (json && typeof json === "object" ? json : {}) as { streams?: unknown; format?: unknown };
  const streams = Array.isArray(root.streams) ? (root.streams as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object") : [];
  const format = (root.format && typeof root.format === "object" ? root.format : {}) as Record<string, unknown>;
  const video = streams.find((s) => s.codec_type === "video" && (s.disposition as Record<string, unknown> | undefined)?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === "audio");

  let width = numberOf(video?.width);
  let height = numberOf(video?.height);
  let rotation = numberOf((video?.tags as Record<string, unknown> | undefined)?.rotate);
  const sideData = Array.isArray(video?.side_data_list) ? (video!.side_data_list as Record<string, unknown>[]) : [];
  for (const side of sideData) if (side.rotation !== undefined) rotation = numberOf(side.rotation);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];

  const duration = numberOf(format.duration) || numberOf(video?.duration) || numberOf(audio?.duration);
  const size = numberOf(format.size);
  return {
    duration,
    width,
    height,
    fps: parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate),
    hasVideo: !!video && width > 0 && height > 0,
    hasAudio: !!audio,
    videoCodec: typeof video?.codec_name === "string" ? video.codec_name : null,
    sizeBytes: size > 0 ? size : null,
  };
}

/* ------------------------------------------------------------------ */
/* ffmpeg arguments                                                     */
/* ------------------------------------------------------------------ */

export interface PlannedVariant {
  height: number;
  width: number;
  /** Folder (relative to the job's work folder) holding this rendition. */
  dir: string;
  playlist: string;
  codecs: string;
  profile: RenditionProfile;
  level: number;
}

export interface HlsPlan {
  args: string[];
  variants: PlannedVariant[];
}

export const MASTER_PLAYLIST = "master.m3u8";
export const POSTER_FILE = "poster.jpg";

/**
 * ffmpeg arguments producing one fMP4 HLS playlist per height. Paths are
 * relative to the work folder (ffmpeg runs with it as cwd), with forward
 * slashes so ffmpeg places each `init.mp4` next to its playlist on Windows too.
 */
export function buildHlsPlan(input: string, probe: ProbeInfo, heights: number[], opts: { segmentSeconds?: number; preset?: string } = {}): HlsPlan {
  const segment = opts.segmentSeconds ?? SEGMENT_SECONDS;
  const fps = probe.fps > 0 ? Math.min(probe.fps, 60) : 30;
  const variants: PlannedVariant[] = heights.map((height) => {
    const width = scaledWidth(probe, height);
    const profile = profileFor(height);
    const level = h264Level(width, height, fps);
    return { height, width, dir: `${height}p`, playlist: `${height}p/index.m3u8`, codecs: codecString(profile.profile, level, probe.hasAudio), profile, level };
  });

  const split = variants.length > 1 ? `[0:v]split=${variants.length}${variants.map((_, i) => `[s${i}]`).join("")};` : "";
  const scales = variants.map((v, i) => `${variants.length > 1 ? `[s${i}]` : "[0:v]"}scale=${v.width}:${v.height}:flags=bicubic,setsar=1,format=yuv420p[v${i}]`).join(";");

  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", input, "-filter_complex", `${split}${scales}`];
  variants.forEach((v, i) => {
    args.push("-map", `[v${i}]`);
    if (probe.hasAudio) args.push("-map", "0:a:0");
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      opts.preset ?? X264_PRESET,
      "-profile:v",
      v.profile.profile,
      "-level:v",
      (v.level / 10).toFixed(1),
      "-crf",
      String(v.profile.crf),
      "-maxrate",
      `${v.profile.maxrateKbps}k`,
      "-bufsize",
      `${v.profile.bufsizeKbps}k`,
      "-force_key_frames",
      `expr:gte(t,n_forced*${segment})`,
      "-sc_threshold",
      "0",
    );
    if (probe.fps > 60) args.push("-r", "60");
    if (probe.hasAudio) args.push("-c:a", "aac", "-b:a", `${v.profile.audioKbps}k`, "-ac", "2", "-ar", "48000");
    args.push(
      "-f",
      "hls",
      "-hls_time",
      String(segment),
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_flags",
      "independent_segments",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      `${v.dir}/seg_%05d.m4s`,
      v.playlist,
    );
  });
  return { args, variants };
}

/** One JPEG frame (10% in, at most 30 s) scaled to at most 720 pixels high. */
export function buildPosterArgs(input: string, probe: ProbeInfo): string[] {
  const at = probe.duration > 0 ? Math.min(30, Math.max(0, probe.duration * 0.1)) : 1;
  const height = Math.min(720, even(probe.height) || 720);
  return ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", at.toFixed(2), "-i", input, "-frames:v", "1", "-vf", `scale=-2:${height}`, "-q:v", "3", POSTER_FILE];
}

/* ------------------------------------------------------------------ */
/* Progress                                                             */
/* ------------------------------------------------------------------ */

export interface FfmpegProgress {
  /** Seconds of output written so far. */
  outTime: number;
  /** Encoding speed relative to real time (e.g. 2.5), when reported. */
  speed: number | null;
  done: boolean;
}

/**
 * Incremental parser for `-progress pipe:1` output (key=value lines, one
 * block per update ending in `progress=continue|end`). Feed it raw stdout
 * chunks; it keeps partial lines between calls.
 */
export class FfmpegProgressParser {
  private buffer = "";
  private state: FfmpegProgress = { outTime: 0, speed: null, done: false };

  /** Consume a chunk; returns the latest state when a block finished in it, else null. */
  push(chunk: string): FfmpegProgress | null {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    let completed = false;
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === "out_time_us" || key === "out_time_ms") {
        // ffmpeg reports microseconds under both names.
        const us = Number(value);
        if (Number.isFinite(us) && us >= 0) this.state.outTime = us / 1_000_000;
      } else if (key === "out_time") {
        const seconds = parseClock(value);
        if (seconds !== null && this.state.outTime === 0) this.state.outTime = seconds;
      } else if (key === "speed") {
        const s = Number.parseFloat(value);
        this.state.speed = Number.isFinite(s) && s > 0 ? s : null;
      } else if (key === "progress") {
        if (value === "end") this.state.done = true;
        completed = true;
      }
    }
    return completed ? { ...this.state } : null;
  }

  get current(): FfmpegProgress {
    return { ...this.state };
  }
}

/** "01:02:03.500000" → 3723.5; null for "N/A" or garbage. */
export function parseClock(value: string): number | null {
  const m = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!m || m[1]) return null;
  return Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** Whole percent (0–99 while running; 100 is reserved for "published"). */
export function progressPercent(outTime: number, duration: number): number {
  if (!(duration > 0) || !(outTime > 0)) return 0;
  return Math.max(0, Math.min(99, Math.floor((outTime / duration) * 100)));
}

/** Keep the end of a long stderr log (the error is usually in the last lines). */
export function tailText(text: string, maxChars = 2000): string {
  const clean = text.replace(/\r/g, "").trim();
  return clean.length > maxChars ? `…${clean.slice(clean.length - maxChars + 1)}` : clean;
}
