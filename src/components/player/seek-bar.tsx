"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clamp, cn, formatTime } from "@/lib/utils";
import type { BufferedRange } from "./use-video-player";

export interface SeekChapter {
  time: number;
  title: string;
}

export interface SeekMarker {
  time: number;
  id: string;
  label?: string;
  kind?: "quiz" | "note" | "custom";
}

export function chapterAt(chapters: SeekChapter[] | undefined, time: number): SeekChapter | null {
  if (!chapters?.length) return null;
  let current: SeekChapter | null = null;
  for (const c of chapters) {
    if (c.time <= time) current = c;
    else break;
  }
  return current;
}

export function SeekBar({
  currentTime,
  duration,
  buffered,
  chapters,
  markers,
  maxSeekable,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onMarkerClick,
  className,
}: {
  currentTime: number;
  duration: number;
  buffered: BufferedRange[];
  chapters?: SeekChapter[];
  markers?: SeekMarker[];
  /** When set, the bar shows a "locked" region beyond this time. */
  maxSeekable?: number;
  onSeek: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onMarkerClick?: (marker: SeekMarker) => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || !duration) return 0;
      const rect = el.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      return pct * duration;
    },
    [duration],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const t = timeFromEvent(e.clientX);
    setScrubbing(true);
    setScrubTime(t);
    onScrubStart?.();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeFromEvent(e.clientX);
    setHoverTime(t);
    if (scrubbing) setScrubTime(t);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    const t = timeFromEvent(e.clientX);
    setScrubbing(false);
    onSeek(t);
    onScrubEnd?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(currentTime + step);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(currentTime - step);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(duration);
    }
  };

  const shown = scrubbing ? scrubTime : currentTime;
  const playedPct = duration ? (shown / duration) * 100 : 0;
  const hoverPct = hoverTime !== null && duration ? (hoverTime / duration) * 100 : null;
  const lockedPct = maxSeekable !== undefined && duration ? clamp((maxSeekable / duration) * 100, 0, 100) : null;

  // Chapter segments: [start, end) pairs.
  const segments =
    chapters && chapters.length > 1 && duration
      ? chapters.map((c, i) => ({ start: c.time, end: i + 1 < chapters.length ? chapters[i + 1]!.time : duration, title: c.title }))
      : [{ start: 0, end: duration || 1, title: "" }];

  const hoverChapter = hoverTime !== null ? chapterAt(chapters, hoverTime) : null;

  return (
    <div className={cn("group/seek relative w-full select-none py-2", className)}>
      {/* Hover tooltip */}
      {hoverPct !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-center text-xs text-white shadow"
          style={{ left: `${clamp(hoverPct, 4, 96)}%` }}
        >
          {hoverChapter && <div className="mb-0.5 max-w-48 truncate text-[11px] font-medium text-white/80">{hoverChapter.title}</div>}
          {formatTime(scrubbing ? scrubTime : hoverTime!)}
        </div>
      )}

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
        className="relative h-3 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrubbing(false)}
        onPointerLeave={() => setHoverTime(null)}
        onKeyDown={onKeyDown}
      >
        {/* Track split into chapter segments */}
        <div className="absolute inset-x-0 top-1/2 flex h-1 -translate-y-1/2 gap-0.5 transition-[height] group-hover/seek:h-1.5">
          {segments.map((seg, i) => {
            const widthPct = duration ? ((seg.end - seg.start) / duration) * 100 : 100;
            const segStartPct = duration ? (seg.start / duration) * 100 : 0;
            const within = (pct: number | null) => (pct === null ? 0 : clamp(((pct - segStartPct) / widthPct) * 100, 0, 100));
            const bufferedInSeg = buffered.reduce((max, r) => {
              const overlapEnd = Math.min(r.end, seg.end);
              const overlapStart = Math.max(r.start, seg.start);
              if (overlapEnd <= overlapStart) return max;
              return Math.max(max, ((overlapEnd - seg.start) / (seg.end - seg.start)) * 100);
            }, 0);
            return (
              <div key={i} className="relative h-full overflow-hidden rounded-full bg-white/25" style={{ width: `${widthPct}%` }} title={seg.title || undefined}>
                <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufferedInSeg}%` }} />
                {hoverPct !== null && <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${within(hoverPct)}%` }} />}
                <div className="absolute inset-y-0 left-0 bg-[var(--player-accent)]" style={{ width: `${within(playedPct)}%` }} />
              </div>
            );
          })}
        </div>

        {/* Locked region (prevent skipping) */}
        {lockedPct !== null && lockedPct < 100 && (
          <div
            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-r-full bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.15)_0_4px,transparent_4px_8px)] group-hover/seek:h-1.5"
            style={{ left: `${lockedPct}%`, right: 0 }}
            aria-hidden="true"
          />
        )}

        {/* Markers */}
        {markers?.map((m) => {
          const pct = duration ? (m.time / duration) * 100 : 0;
          return (
            <button
              key={m.id}
              type="button"
              className={cn(
                "absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm rotate-45 border border-black/40 shadow",
                m.kind === "note" ? "bg-yellow-300" : "bg-amber-400",
              )}
              style={{ left: `${pct}%` }}
              title={m.label ?? (m.kind === "quiz" ? "Quiz" : "Marker")}
              aria-label={m.label ?? "Marker"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (onMarkerClick) onMarkerClick(m);
                else onSeek(m.time);
              }}
            />
          );
        })}

        {/* Thumb */}
        <div
          className={cn(
            "absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-accent)] shadow-[0_0_0_2px_rgba(0,0,0,0.3)] transition-transform",
            scrubbing ? "scale-125" : "scale-0 group-hover/seek:scale-100 group-focus-within/seek:scale-100",
          )}
          style={{ left: `${playedPct}%` }}
        />
      </div>
    </div>
  );
}
