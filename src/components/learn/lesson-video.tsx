"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { VideoPlayer, type HeartbeatPayload, type SeekMarker } from "@/components/player";
import type { VideoChapterMarker, VideoQuizMarker } from "@/lib/types";

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
}

/**
 * The lesson-page video: wires the custom player to the progress API so
 * watch time, resume position and completion are stored per learner.
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
}: LessonVideoProps) {
  const [completed, setCompleted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const heartbeat = useCallback(
    (data: HeartbeatPayload) => {
      if (!track) return;
      const payload = JSON.stringify({ lessonId, blockId, source: src, ...data });
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
    [track, lessonId, blockId, src, completed, onCompleted],
  );

  /** Continue playback after an in-video quiz. */
  const resume = useCallback(() => {
    const video = wrapRef.current?.querySelector("video");
    if (video) void video.play().catch(() => undefined);
  }, []);

  const markers: SeekMarker[] | undefined = quizMarkers?.map((m) => ({ id: `${m.quizId}@${m.time}`, time: m.time, label: "Quiz", kind: "quiz" }));

  return (
    <div ref={wrapRef} className="w-full">
      <VideoPlayer
        src={src}
        poster={posterUrl}
        captionsUrl={captionsUrl}
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
        theater={theater}
        onToggleTheater={onToggleTheater}
        className={className}
        seekRequest={seekRequest}
        onTimeChange={onTimeChange}
        overlay={overlay}
      />
    </div>
  );
}
