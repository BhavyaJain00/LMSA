import type { LessonBlock, VideoTranscodeState } from "@/lib/types";
import { storageKeyFromUrl } from "@/lib/storage/keys";

/**
 * Pure helpers linking lesson video blocks to the transcoding pipeline.
 *
 * The HLS fields of a video block (`hlsUrl`, `transcode`, `storageKey`) are
 * written by the server when a conversion finishes; the lesson editor never
 * sets them. `preserveManagedVideoFields` carries them (and the transcript,
 * plus a duration/poster the pipeline filled in) over when an editor save
 * replaces the blocks, as long as the block still plays the same file.
 */

export type VideoBlock = Extract<LessonBlock, { type: "video" }>;

/** File types ffmpeg converts; anything else keeps playing as uploaded. */
export const TRANSCODABLE_EXTENSIONS = [".mp4", ".m4v", ".mov", ".webm", ".ogv", ".mkv"] as const;
export const HLS_SEGMENT = "hls";

/** Ids used in storage paths (lesson and block ids are generated `[a-z0-9_]` strings). */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Key prefix holding every HLS version of a block: `videos/<lessonId>/<blockId>/hls/`. */
export function hlsKeyPrefix(lessonId: string, blockId: string): string {
  if (!SAFE_ID.test(lessonId) || !SAFE_ID.test(blockId)) throw new Error("Invalid lesson or block id for a storage path.");
  return `videos/${lessonId}/${blockId}/${HLS_SEGMENT}/`;
}

/** Storage key of a block's uploaded source video, or null when it is not a convertible upload. */
export function transcodeSourceKey(src: string | undefined, siteOrigins: readonly string[] = []): string | null {
  const key = storageKeyFromUrl(src, siteOrigins);
  if (!key) return null;
  const lower = key.toLowerCase();
  if (!TRANSCODABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;
  // Never feed the pipeline its own output.
  if (lower.split("/").includes(HLS_SEGMENT)) return null;
  return key;
}

/**
 * Generated HLS version folders: `videos/<lessonId>/<blockId>/hls/<version>/`
 * (lesson blocks) and `videos/course/<courseId>/preview/hls/<version>/`
 * (course preview videos).
 */
export const HLS_VERSION_FOLDER = /^(videos\/(?:course\/[^/]+\/preview|[^/]+\/[^/]+)\/hls\/[^/]+\/)/;

/** HLS version folder of a storage key inside one, or null. */
export function hlsVersionFolderOfKey(key: string): string | null {
  const m = HLS_VERSION_FOLDER.exec(key);
  return m ? m[1]! : null;
}

/** HLS version folder of a stored `hlsUrl` (`videos/l/b/hls/v1/`, `videos/course/c/preview/hls/v1/`), or null. */
export function hlsVersionPrefix(hlsUrl: string | undefined, siteOrigins: readonly string[] = []): string | null {
  const key = storageKeyFromUrl(hlsUrl, siteOrigins);
  return key ? hlsVersionFolderOfKey(key) : null;
}

/** The block's HLS output was made from its current source file. */
export function hlsMatchesSource(block: Pick<VideoBlock, "src" | "hlsUrl" | "storageKey">, siteOrigins: readonly string[] = []): boolean {
  const key = transcodeSourceKey(block.src, siteOrigins);
  return !!block.hlsUrl && !!key && block.storageKey === key;
}

function sameSource(a: string | undefined, b: string | undefined, siteOrigins: readonly string[]): boolean {
  if (!a || !b) return false;
  const ka = storageKeyFromUrl(a, siteOrigins);
  const kb = storageKeyFromUrl(b, siteOrigins);
  return ka && kb ? ka.toLowerCase() === kb.toLowerCase() : a.trim() === b.trim();
}

/**
 * Carry server-managed video fields from the stored blocks into blocks
 * submitted by an editor save:
 *  - same block id and same source file → keep `hlsUrl`, `transcode`,
 *    `storageKey`, `transcriptId`; keep the stored duration and poster when
 *    the submitted block leaves them empty;
 *  - a new source file → the old HLS output and transcript no longer apply
 *    and are dropped (the new file is queued for conversion).
 * Values sent by the client for managed fields are never trusted.
 */
export function preserveManagedVideoFields(previous: readonly LessonBlock[], next: LessonBlock[], siteOrigins: readonly string[] = []): LessonBlock[] {
  const before = new Map(previous.filter((b): b is VideoBlock => b.type === "video").map((b) => [b.id, b]));
  return next.map((block) => {
    if (block.type !== "video") return block;
    const out: VideoBlock = { ...block };
    delete out.hlsUrl;
    delete out.transcode;
    delete out.storageKey;
    delete out.transcriptId;
    const old = before.get(block.id);
    if (!old || !sameSource(old.src, block.src, siteOrigins)) return out;
    if (old.hlsUrl) out.hlsUrl = old.hlsUrl;
    if (old.transcode) out.transcode = old.transcode;
    if (old.storageKey) out.storageKey = old.storageKey;
    if (old.transcriptId) out.transcriptId = old.transcriptId;
    if (out.duration === undefined && old.duration !== undefined) out.duration = old.duration;
    if (!out.posterUrl && old.posterUrl) out.posterUrl = old.posterUrl;
    return out;
  });
}

/** State written when a conversion is queued, keeping renditions of an older finished conversion. */
export function pendingState(previous: VideoTranscodeState | undefined, now: string): VideoTranscodeState {
  return { status: "pending", progress: 0, renditions: previous?.renditions, updatedAt: now };
}

/** Human label for a set of rendition heights: "1080p/720p/480p". */
export function renditionLabel(heights: readonly number[]): string {
  return [...heights].sort((a, b) => b - a).map((h) => `${h}p`).join("/");
}
