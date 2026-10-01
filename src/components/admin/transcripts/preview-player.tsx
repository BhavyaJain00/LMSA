"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptCue, VideoSource } from "@/lib/types";
import { VideoPlayer } from "@/components/player";
import { cueIndexAt, normalizeCues } from "@/lib/transcripts/cues";
import { serializeVtt } from "@/lib/transcripts/format";
import { languageLabel } from "@/lib/transcripts/editor-shared";
import { formatTimeInput } from "@/lib/transcripts/editor-state";
import { Icon } from "@/components/ui/icons";

export interface PreviewVideo {
  id: string;
  src: string;
  hlsUrl?: string;
  posterUrl?: string;
  captionsUrl?: string;
  sources?: VideoSource[];
  title?: string;
  duration?: number;
}

/** How long cue edits settle before the caption track is rebuilt. */
const CAPTION_REBUILD_MS = 600;
/** How often the playhead is read from the video element. */
const TICK_MS = 150;

/**
 * The lesson video with the editor's unsaved captions as its caption track
 * (a WebVTT blob rebuilt shortly after each edit), and the line showing at
 * the playhead underneath. Reports the playhead through `onTick` (read
 * from the video element, which survives the player swapping sources).
 */
export function PreviewPlayer({
  lessonId,
  video,
  cues,
  language,
  seekRequest,
  time,
  onTick,
  onJumpToCue,
}: {
  lessonId: string;
  video: PreviewVideo;
  cues: readonly TranscriptCue[];
  language: string;
  seekRequest?: { time: number; key: number; play?: boolean };
  /** Playhead last reported through `onTick`. */
  time: number;
  onTick: (time: number) => void;
  onJumpToCue: (index: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mediaContext = useMemo(() => ({ lessonId }), [lessonId]);
  const [captionsUrl, setCaptionsUrl] = useState<string | undefined>(undefined);

  // Rebuild the caption track from the current (unsaved) cues once edits settle.
  useEffect(() => {
    let url: string | null = null;
    const timer = window.setTimeout(() => {
      const clean = normalizeCues(cues);
      if (!clean.length) {
        setCaptionsUrl(undefined);
        return;
      }
      url = URL.createObjectURL(new Blob([serializeVtt(clean, { language })], { type: "text/vtt" }));
      setCaptionsUrl(url);
    }, CAPTION_REBUILD_MS);
    return () => {
      window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [cues, language]);

  // Follow the playhead. Polling the element survives the player swapping it (HLS fallback, quality changes).
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);
  useEffect(() => {
    let last = -1;
    const id = window.setInterval(() => {
      const el = wrapRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]");
      if (!el || el.readyState < 1) return;
      const t = el.currentTime;
      if (Math.abs(t - last) < 0.01) return;
      last = t;
      onTickRef.current(t);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const showing = cueIndexAt(cues, time);
  const cue = showing >= 0 ? cues[showing] : null;

  return (
    <div className="space-y-3">
      <div ref={wrapRef} className="overflow-hidden rounded-card bg-black shadow-card">
        <VideoPlayer
          src={video.src}
          hlsUrl={video.hlsUrl}
          sources={video.sources}
          poster={video.posterUrl}
          title={video.title}
          captionsUrl={captionsUrl}
          captionsLabel={`${languageLabel(language)} (preview)`}
          captionsLang={language}
          mediaContext={mediaContext}
          watermark={null}
          seekRequest={seekRequest}
        />
      </div>
      <div className="rounded-card border border-border bg-surface-1 p-3" aria-live="off">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon.Captions className="size-3.5" /> Showing at <span className="font-mono tabular-nums text-ink">{formatTimeInput(time)}</span>
          </span>
          {cue && (
            <button type="button" onClick={() => onJumpToCue(showing)} className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
              Caption {showing + 1}
            </button>
          )}
        </div>
        <p className="mt-1.5 min-h-10 whitespace-pre-line text-sm leading-snug text-ink">
          {cue ? cue.text || <span className="italic text-ink-faint">(empty caption)</span> : <span className="text-ink-faint">No caption at this moment.</span>}
        </p>
        {video.captionsUrl && (
          <p className="mt-2 flex gap-1.5 border-t border-border pt-2 text-xs text-ink-muted">
            <Icon.Info className="mt-0.5 size-3.5 shrink-0" />
            This video also has its own caption file, which learners get as captions. The transcript still powers the transcript panel, search and the AI tutor.
          </p>
        )}
      </div>
    </div>
  );
}
