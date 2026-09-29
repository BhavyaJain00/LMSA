import "server-only";
import type { LessonBlock, Settings, User, VideoSource } from "@/lib/types";
import { findById, getSettings } from "@/lib/db/store";
import { lessonReferencesPath, siteOrigins } from "./access";
import { GUEST_MEDIA_SUBJECT, parseMediaSrc, stripMediaToken, withMediaToken } from "./paths";
import { issueMediaToken, mediaSigningAvailable } from "./token";

/**
 * Server-side signing of lesson video URLs.
 *
 * Only uploads under `/uploads/videos/` are signed, and only while
 * `settings.video.protectUploads` is on. External URLs, other uploads and
 * everything while protection is off pass through unchanged.
 *
 * Without a usable APP_SECRET (e.g. missing in production) nothing can be
 * signed: lesson pages then render protected videos unsigned, the player asks
 * `/api/media/sign`, which answers 503, and the block shows "video
 * unavailable" instead of the whole lesson crashing.
 */

export interface SignedMedia {
  /** Playable src (signed when protection applies). */
  src: string;
  /** Token expiry (unix seconds), or null when the src is not signed. */
  expiresAt: number | null;
}

/** Signed URL lifetime from settings (5–240 minutes). */
export function signedUrlTtlSeconds(settings: Pick<Settings, "video">): number {
  const minutes = Number.isFinite(settings.video.signedUrlMinutes) ? settings.video.signedUrlMinutes : 60;
  return Math.min(Math.max(Math.round(minutes), 5), 240) * 60;
}

/**
 * Sign `src` for a subject (user id, or null for a signed-out visitor).
 * Callers must have authorized the viewer first (see `authorizeMediaAccess`).
 * Throws `MediaSigningUnavailableError` without a usable APP_SECRET.
 */
export function signMediaForSubject(src: string, userId: string | null, settings: Pick<Settings, "video">, requestOrigin?: string | null): SignedMedia {
  const parsed = parseMediaSrc(src, siteOrigins(requestOrigin));
  if (!parsed || !parsed.isProtectedVideo || !settings.video.protectUploads) {
    return { src: parsed?.isProtectedVideo ? stripMediaToken(src) : src, expiresAt: null };
  }
  const { token, expires } = issueMediaToken(parsed.path, userId || GUEST_MEDIA_SUBJECT, signedUrlTtlSeconds(settings));
  return { src: withMediaToken(parsed.path, token), expiresAt: expires };
}

/**
 * Pre-sign a lesson video URL for a viewer (used by the lesson page, which
 * has already authorized the viewer for the lesson). Returns the src
 * unchanged when no signing is needed, and an unsigned src when the video
 * does not belong to the lesson (it will then not play — fail closed).
 */
export async function signMediaUrl(src: string, userId: string | null, lessonId: string): Promise<string> {
  const settings = await getSettings();
  const parsed = parseMediaSrc(src, siteOrigins());
  if (!parsed || !parsed.isProtectedVideo || !settings.video.protectUploads) return src;
  const lesson = await findById("lessons", lessonId);
  if (!lesson || !lessonReferencesPath(lesson, parsed.path) || !mediaSigningAvailable()) return stripMediaToken(src);
  return signMediaForSubject(src, userId, settings).src;
}

/* ------------------------------------------------------------------ */
/* Lesson page helpers                                                  */
/* ------------------------------------------------------------------ */

export interface PlayerWatermark {
  text: string;
  /** 0.05 – 0.5 */
  opacity: number;
}

/** Site-wide player options from `settings.video` for a viewer. */
export interface LessonPlayerOptions {
  watermark: PlayerWatermark | null;
  seekThumbnails: boolean;
  autoplayNext: boolean;
  /** Lifetime of signed URLs (seconds) while protection is on: the player schedules renewals from it, not from its own clock. */
  signedUrlTtlSeconds: number | null;
}

export interface LessonVideoMedia {
  src: string;
  sources?: VideoSource[];
}

export function watermarkFor(viewer: Pick<User, "email" | "name"> | null, settings: Pick<Settings, "video">): PlayerWatermark | null {
  if (!viewer || !settings.video.watermark) return null;
  const text = (viewer.email || viewer.name || "").trim();
  if (!text) return null;
  const opacity = Math.min(Math.max(settings.video.watermarkOpacity || 0.18, 0.05), 0.5);
  return { text, opacity };
}

export function playerOptionsFor(viewer: Pick<User, "email" | "name"> | null, settings: Pick<Settings, "video">): LessonPlayerOptions {
  return {
    watermark: watermarkFor(viewer, settings),
    seekThumbnails: settings.video.seekThumbnails,
    autoplayNext: settings.video.autoplayNext,
    signedUrlTtlSeconds: settings.video.protectUploads ? signedUrlTtlSeconds(settings) : null,
  };
}

/**
 * Signed srcs (main + extra qualities) for every video block of a lesson,
 * plus the player options for the viewer. The caller must only render
 * lessons the viewer may open.
 */
export async function prepareLessonVideos(
  blocks: LessonBlock[],
  lessonId: string,
  viewer: Pick<User, "id" | "email" | "name"> | null,
): Promise<{ media: Record<string, LessonVideoMedia>; player: LessonPlayerOptions }> {
  const settings = await getSettings();
  const media: Record<string, LessonVideoMedia> = {};
  const hasVideo = blocks.some((b) => b.type === "video");
  if (hasVideo) {
    const lesson = await findById("lessons", lessonId);
    const origins = siteOrigins();
    // Checked once: without a usable APP_SECRET protected videos are left unsigned (shown as unavailable).
    const canSign = !settings.video.protectUploads || mediaSigningAvailable();
    const sign = (src: string): string => {
      const parsed = parseMediaSrc(src, origins);
      if (!parsed?.isProtectedVideo || !settings.video.protectUploads) return src;
      if (!canSign || !lesson || !lessonReferencesPath(lesson, parsed.path, origins)) return stripMediaToken(src);
      return signMediaForSubject(src, viewer?.id ?? null, settings).src;
    };
    for (const block of blocks) {
      if (block.type !== "video") continue;
      media[block.id] = {
        src: sign(block.src),
        sources: block.sources?.length ? block.sources.map((s) => ({ ...s, src: sign(s.src) })) : undefined,
      };
    }
  }
  return { media, player: playerOptionsFor(viewer, settings) };
}
