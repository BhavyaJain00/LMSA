"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VideoPlayer, type HeartbeatPayload, type PlayerWatermarkOptions, type SeekMarker } from "@/components/player";
import type { VideoChapterMarker, VideoQuizMarker, VideoSource } from "@/lib/types";
import { stripMediaToken } from "@/lib/media/paths";
import { useT } from "@/i18n/client";

const PLAY_EVENT = "ll:lesson-video-play";

export interface LessonVideoProps {
  lessonId: string;
  blockId: string;
  src: string;
  posterUrl?: string;
  captionsUrl?: string;
  title?: string;
  chapters?: VideoChapterMarker[];
  quizMarkers?: VideoQuizMarker[];
  /** Resume position from the server. */
  startAt?: number;
  initialMaxPosition?: number;
  preventSkipping?: boolean;
  /** Whether to record progress (false for guests / preview). */
  track?: boolean;
  /** Fired once the server reports the video as watched (≥ completion threshold). */
  onCompleted?: () => void;
  /** Fired when playback reaches the end of the video. */
  onEnded?: () => void;
  /** Fired when playback crosses a quiz marker (the player is paused first). Call `resume` to continue playback. */
  onQuizMarker?: (quizId: string, resume: () => void) => void;
  onNext?: () => void;
  nextLabel?: string;
  theater?: boolean;
  onToggleTheater?: () => void;
  autoPlay?: boolean;
  className?: string;
  /** External seek request (change `key` to seek). */
  seekRequest?: { time: number; key: number; play?: boolean };
  /** Current playback time, reported once per second. */
  onTimeChange?: (time: number) => void;
  /** Content rendered above the video (e.g. an in-video quiz). */
  overlay?: ReactNode;

  /* ----- round 2 ----- */
  /** Extra renditions for the quality menu (pre-signed by the server when protected). */
  sources?: VideoSource[];
  /** Viewer watermark (null = off). */
  watermark?: PlayerWatermarkOptions | null;
  seekThumbnails?: boolean;
  /** Count down to `onNext` when the video ends. */
  autoplayNext?: boolean;
  nextTitle?: string;
  /** Dock into a floating mini-player when scrolled away while playing. */
  miniPlayer?: boolean;
  /** Lifetime (seconds) of the pre-signed `src`: renewals are scheduled from it rather than the browser clock. */
  signedUrlTtlSeconds?: number | null;

  /* ----- round 3 ----- */
  /** HLS master playlist (pre-signed when protected): adaptive streaming, with `src` as the progressive fallback. */
  hlsUrl?: string;
  /** Menu label and language (BCP 47) of the caption track, e.g. when it is built from the transcript. */
  captionsLabel?: string;
  captionsLang?: string;
}

/**
 * The lesson-page video: wires the custom player to the progress API so
 * watch time, resume position, completion and retention ranges are stored
 * per learner, and scopes signed-URL refreshes to the lesson.
 */
export function LessonVideo({
  lessonId,
  blockId,
  src,
  posterUrl,
  captionsUrl,
  title,
  chapters,
  quizMarkers,
  startAt,
  initialMaxPosition,
  preventSkipping,
  track = true,
  onCompleted,
  onEnded,
  onQuizMarker,
  onNext,
  nextLabel,
  theater,
  onToggleTheater,
  autoPlay,
  className,
  seekRequest,
  onTimeChange,
  overlay,
  sources,
  watermark,
  seekThumbnails,
  autoplayNext,
  nextTitle,
  miniPlayer,
  signedUrlTtlSeconds,
  hlsUrl,
  captionsLabel,
  captionsLang,
}: LessonVideoProps) {
  const t = useT("learning");
  const [completed, setCompleted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Never store signed tokens in watch records.
  const source = useMemo(() => stripMediaToken(src), [src]);
  const mediaContext = useMemo(() => ({ lessonId, ttlSeconds: signedUrlTtlSeconds ?? null }), [lessonId, signedUrlTtlSeconds]);

  const heartbeat = useCallback(
    (data: HeartbeatPayload) => {
      if (!track) return;
      const payload = JSON.stringify({ lessonId, blockId, source, ...data });
      // Prefer fetch (we want the response to learn about completion); fall back to sendBeacon when leaving the page.
      if (document.visibilityState === "hidden" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/video-progress", new Blob([payload], { type: "text/plain" }));
        return;
      }
      fetch("/api/video-progress", { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true })
        .then((r) => (r.ok ? r.json() : null))
        .then((res: { completed?: boolean } | null) => {
          if (res?.completed && !completed) {
            setCompleted(true);
            onCompleted?.();
          }
        })
        .catch(() => undefined);
    },
    [track, lessonId, blockId, source, completed, onCompleted],
  );

  /** Continue playback after an in-video quiz. */
  const resume = useCallback(() => {
    const video = wrapRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]");
    if (video) void video.play().catch(() => undefined);
  }, []);

  // Only one lesson video plays at a time (and only one can be docked as a mini-player).
  useEffect(() => {
    const video = wrapRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]");
    if (!video) return;
    const onPlay = () => window.dispatchEvent(new CustomEvent<string>(PLAY_EVENT, { detail: blockId }));
    const onOtherPlay = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== blockId && !video.paused) video.pause();
    };
    video.addEventListener("play", onPlay);
    window.addEventListener(PLAY_EVENT, onOtherPlay);
    return () => {
      video.removeEventListener("play", onPlay);
      window.removeEventListener(PLAY_EVENT, onOtherPlay);
    };
  }, [blockId]);

  const markers: SeekMarker[] | undefined = quizMarkers?.map((m) => ({ id: `${m.quizId}@${m.time}`, time: m.time, label: t("learn.video.quiz"), kind: "quiz" }));

  return (
    <div ref={wrapRef} className="w-full">
      <VideoPlayer
        src={src}
        sources={sources}
        hlsUrl={hlsUrl}
        mediaContext={mediaContext}
        poster={posterUrl}
        captionsUrl={captionsUrl}
        captionsLabel={captionsLabel}
        captionsLang={captionsLang}
        title={title}
        chapters={chapters}
        markers={markers}
        startAt={startAt}
        initialMaxPosition={initialMaxPosition}
        preventSkipping={preventSkipping}
        autoPlay={autoPlay}
        onHeartbeat={heartbeat}
        onEnded={onEnded}
        onMarker={(m) => {
          const quizId = m.id.split("@")[0]!;
          onQuizMarker?.(quizId, resume);
        }}
        onNext={onNext}
        nextLabel={nextLabel}
        nextTitle={nextTitle}
        autoplayNext={autoplayNext}
        theater={theater}
        onToggleTheater={onToggleTheater}
        className={className}
        seekRequest={seekRequest}
        onTimeChange={onTimeChange}
        overlay={overlay}
        watermark={watermark}
        seekThumbnails={seekThumbnails}
        miniPlayer={miniPlayer}
      />
    </div>
  );
}
