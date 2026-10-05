import type { VideoTranscodeState } from "@/lib/types";
import type { TranscodeJobView } from "./queue";
import { renditionLabel } from "./lesson-fields";

/**
 * Pure view model for the conversion panels under a video block in the
 * lesson editor and under the preview video in the course settings: what to
 * say, which buttons to offer and how often to poll `GET /api/media/status`.
 * Shared by the editor components and tests.
 */

/** What `GET /api/media/status` reports for any converted video (lesson block or course preview). */
export interface MediaStatusCore {
  /** Adaptive streaming is switched on in Settings → Storage & video. */
  enabled: boolean;
  ffmpeg: { available: boolean; error: string | null; hint: string | null };
  /** The saved video is a file uploaded to this site that ffmpeg can convert. */
  convertible: boolean;
  /** The video exists in the saved lesson or course (unsaved blocks cannot be converted yet). */
  saved: boolean;
  /** Video URL that is saved (the editor compares it with unsaved edits). */
  savedSrc: string | null;
  transcode: VideoTranscodeState | null;
  /** An HLS stream made from the current file exists. */
  hlsReady: boolean;
  job: TranscodeJobView | null;
  /** Rendition heights configured in settings (what a new conversion produces, capped at the source height). */
  configuredRenditions: number[];
}

/** Whose video the panel describes: changes "Save the lesson"/"Learners" to "Save the course"/"Visitors". */
export type MediaPanelSubject = "lesson" | "course";

export type MediaPanelTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface MediaPanelView {
  /** Short status line, e.g. "Processing 42% (1080p/720p/480p)". */
  title: string;
  detail: string | null;
  tone: MediaPanelTone;
  /** 0-100 while converting, else null. */
  progress: number | null;
  /** Offer "Convert" / "Convert again" / "Retry". */
  convert: "convert" | "again" | "retry" | null;
  cancel: boolean;
  /** Renditions of the finished stream, highest first. */
  renditions: { height: number; bandwidth: number; label: string }[];
  /** Poll again after this many milliseconds; null stops polling. */
  pollMs: number | null;
}

/** Fast while a job moves, slower while waiting for a save or for the worker to pick it up. */
export const POLL_RUNNING_MS = 3_000;
export const POLL_QUEUED_MS = 5_000;
export const POLL_IDLE_MS = 15_000;

/** "2.8 Mbit/s" / "850 kbit/s". */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 0 : 1)} Mbit/s`;
  return `${Math.max(1, Math.round(bps / 1000))} kbit/s`;
}

function base(partial: Partial<MediaPanelView> & Pick<MediaPanelView, "title" | "tone">): MediaPanelView {
  return { detail: null, progress: null, convert: null, cancel: false, renditions: [], pollMs: null, ...partial };
}

/**
 * @param status   latest answer of the status endpoint (null when the block is not saved yet)
 * @param src      the current (possibly unsaved) video URL
 * @param subject  a lesson video block (default) or a course's preview video
 */
export function describeMediaStatus(status: MediaStatusCore | null, src: string, subject: MediaPanelSubject = "lesson"): MediaPanelView {
  const page = subject === "course" ? "course" : "lesson";
  const viewers = subject === "course" ? "Visitors" : "Learners";
  if (!src.trim()) return base({ title: "Add a video", tone: "neutral", detail: "Upload a file to convert it for adaptive streaming." });
  if (!status || !status.saved) {
    return base({ title: "Not saved yet", tone: "neutral", detail: `Save the ${page} to convert this video for adaptive streaming.`, pollMs: POLL_IDLE_MS });
  }
  if (status.savedSrc !== src) {
    return base({ title: "New video not saved", tone: "neutral", detail: `Save the ${page} to convert the new video. ${viewers} see the saved one until then.`, pollMs: POLL_IDLE_MS });
  }
  if (!status.convertible) {
    return base({ title: "Plays as linked", tone: "neutral", detail: "Only videos uploaded to this site are converted. Linked videos play exactly as they are." });
  }

  const renditions = (status.hlsReady ? (status.transcode?.renditions ?? []) : [])
    .slice()
    .sort((a, b) => b.height - a.height)
    .map((r) => ({ ...r, label: `${r.height}p` }));
  const job = status.job;

  if (job?.status === "running") {
    const heights = job.heights ?? status.configuredRenditions;
    const pct = Math.max(0, Math.min(100, Math.round(job.progress)));
    return base({
      title: `Processing ${pct}%${heights.length ? ` (${renditionLabel(heights)})` : ""}`,
      tone: "info",
      progress: pct,
      detail: status.hlsReady ? `${viewers} keep getting the previous stream until this one is ready.` : `${viewers} get the original file until the conversion finishes.`,
      cancel: true,
      renditions,
      pollMs: POLL_RUNNING_MS,
    });
  }
  if (job?.status === "queued") {
    return base({
      title: job.queuePosition && job.queuePosition > 1 ? `Queued (number ${job.queuePosition} in line)` : "Queued, starting soon",
      tone: "info",
      progress: 0,
      detail: "Videos are converted one at a time in the background. You can keep editing or leave this page.",
      cancel: true,
      renditions,
      pollMs: POLL_QUEUED_MS,
    });
  }
  if (!status.ffmpeg.available || status.transcode?.status === "unavailable") {
    return base({
      title: "Converter not installed",
      tone: "warning",
      detail: `The original file plays as uploaded. ${status.ffmpeg.hint ?? "Ask an administrator to install ffmpeg."}`,
      renditions,
    });
  }
  if (!status.enabled) {
    return base({
      title: status.hlsReady ? "Ready" : "Adaptive streaming is off",
      tone: status.hlsReady ? "success" : "neutral",
      detail: status.hlsReady
        ? "This video already has a stream. New uploads aren't converted while adaptive streaming is off in Settings → Storage & video."
        : "The original file plays. An administrator can turn on conversion in Settings → Storage & video.",
      renditions,
    });
  }
  if (job?.status === "failed" || status.transcode?.status === "failed") {
    const error = job?.error ?? status.transcode?.error ?? "";
    const firstLine = error.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
    const reason = firstLine ? (/[.!?]$/.test(firstLine) ? firstLine : `${firstLine}.`) : "The conversion didn't finish.";
    return base({
      title: "Failed",
      tone: "danger",
      detail: `${reason} ${status.hlsReady ? "The previous stream keeps playing." : `${viewers} get the original file.`}`.trim(),
      convert: "retry",
      renditions,
    });
  }
  if (status.hlsReady) {
    return base({
      title: "Ready",
      tone: "success",
      detail: renditions.length ? `Adaptive streaming in ${renditionLabel(renditions.map((r) => r.height))}.` : "Adaptive streaming is ready.",
      convert: "again",
      renditions,
    });
  }
  return base({ title: "Waiting to convert", tone: "neutral", detail: "The conversion starts in a moment.", convert: "convert", pollMs: POLL_QUEUED_MS });
}
