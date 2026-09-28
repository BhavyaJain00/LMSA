"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, formatTime } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useVideoPlayer } from "./use-video-player";
import { ControlBar, PLAYBACK_RATES } from "./controls";
import type { SeekChapter, SeekMarker } from "./seek-bar";

export interface HeartbeatPayload {
  /** Current playback position in seconds. */
  position: number;
  /** Seconds actually watched since the previous heartbeat. */
  watchedDelta: number;
  /** Highest position reached in this session. */
  maxPosition: number;
  duration: number;
  ended: boolean;
}

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  captionsUrl?: string;
  captionsLabel?: string;
  captionsLang?: string;
  title?: string;
  chapters?: SeekChapter[];
  /** Points on the timeline (e.g. in-video quizzes). Playback pauses when crossing one. */
  markers?: SeekMarker[];
  /** Resume position in seconds. */
  startAt?: number;
  autoPlay?: boolean;
  /** Disallow seeking beyond the furthest point watched. */
  preventSkipping?: boolean;
  /** Furthest position already watched in earlier sessions (used with preventSkipping). */
  initialMaxPosition?: number;
  /** Seconds between heartbeats (default 10). */
  heartbeatInterval?: number;
  onHeartbeat?: (data: HeartbeatPayload) => void;
  onEnded?: () => void;
  /** Fired when playback crosses a marker (the player pauses first). */
  onMarker?: (marker: SeekMarker) => void;
  /** When provided, an end screen shows a "next" button. */
  onNext?: () => void;
  nextLabel?: string;
  theater?: boolean;
  onToggleTheater?: () => void;
  className?: string;
  /** Extra overlay content (e.g. an in-video quiz). Rendered above the video. */
  overlay?: ReactNode;
  /** Custom accent color for the progress bar; defaults to the site accent. */
  accentColor?: string;
  /**
   * External seek request. Change `key` to trigger a seek to `time` (used by
   * timestamped notes, chapter lists outside the player, etc.).
   */
  seekRequest?: { time: number; key: number; play?: boolean };
  /** Called at most once per second with the current playback time. */
  onTimeChange?: (time: number) => void;
}

/**
 * A fully custom HTML5 video player: no third-party player, no iframes.
 * Supports keyboard shortcuts, chapters, markers, captions, PiP, fullscreen,
 * theater mode, playback speed, resume, watch tracking and anti-skip.
 */
export function VideoPlayer({
  src,
  poster,
  captionsUrl,
  captionsLabel = "English",
  captionsLang = "en",
  title,
  chapters,
  markers,
  startAt,
  autoPlay,
  preventSkipping,
  initialMaxPosition = 0,
  heartbeatInterval = 10,
  onHeartbeat,
  onEnded,
  onMarker,
  onNext,
  nextLabel = "Next lesson",
  theater,
  onToggleTheater,
  className,
  overlay,
  accentColor,
  seekRequest,
  onTimeChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [loop, setLoop] = useState(false);
  const [flash, setFlash] = useState<{ icon: ReactNode; text?: string; key: number } | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [skipBlocked, setSkipBlocked] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashKey = useRef(0);

  // Watch tracking
  const watchedAccum = useRef(0);
  const maxPosition = useRef(Math.max(initialMaxPosition, startAt ?? 0));
  const [maxPos, setMaxPos] = useState(() => Math.max(initialMaxPosition, startAt ?? 0));
  const lastBeat = useRef(0);
  const firedMarkers = useRef(new Set<string>());
  const callbacks = useRef({ onHeartbeat, onEnded, onMarker });
  useEffect(() => {
    callbacks.current = { onHeartbeat, onEnded, onMarker };
  });

  const sendHeartbeat = useCallback(
    (ended = false, force = false) => {
      const video = videoRef.current;
      if (!video) return;
      const now = Date.now();
      if (!force && !ended && now - lastBeat.current < heartbeatInterval * 1000) return;
      if (!force && !ended && watchedAccum.current <= 0) return;
      lastBeat.current = now;
      const payload: HeartbeatPayload = {
        position: video.currentTime,
        watchedDelta: watchedAccum.current,
        maxPosition: maxPosition.current,
        duration: video.duration || 0,
        ended,
      };
      watchedAccum.current = 0;
      callbacks.current.onHeartbeat?.(payload);
    },
    [heartbeatInterval],
  );

  const { state, actions: rawActions } = useVideoPlayer(videoRef, containerRef, {
    startAt,
    onTick: (time, delta) => {
      watchedAccum.current += delta;
      if (time > maxPosition.current) {
        maxPosition.current = time;
        setMaxPos(time);
      }
      // Marker crossing
      if (markers?.length) {
        for (const m of markers) {
          if (!firedMarkers.current.has(m.id) && time >= m.time && time - m.time < 1.5) {
            firedMarkers.current.add(m.id);
            videoRef.current?.pause();
            callbacks.current.onMarker?.(m);
            break;
          }
        }
      }
      sendHeartbeat(false);
    },
    onEnded: () => {
      maxPosition.current = videoRef.current?.duration ?? maxPosition.current;
      setMaxPos(maxPosition.current);
      sendHeartbeat(true, true);
      callbacks.current.onEnded?.();
      if (loop) void videoRef.current?.play();
    },
    canSeekTo: (time) => {
      if (!preventSkipping) return true;
      if (time <= maxPosition.current + 1) return true;
      setSkipBlocked(true);
      setTimeout(() => setSkipBlocked(false), 1800);
      return false;
    },
  });

  // External seek requests (e.g. clicking a timestamped note).
  useEffect(() => {
    if (!seekRequest) return;
    const ok = rawActions.seek(seekRequest.time);
    if (ok && seekRequest.play) void rawActions.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.key]);

  // Throttled time reporting for consumers (notes, transcript highlighting…).
  const lastReported = useRef(-1);
  useEffect(() => {
    if (!onTimeChange) return;
    const whole = Math.floor(state.currentTime);
    if (whole !== lastReported.current) {
      lastReported.current = whole;
      onTimeChange(whole);
    }
  }, [state.currentTime, onTimeChange]);

  // Reset fired markers when the user seeks back before them.
  useEffect(() => {
    if (!markers?.length) return;
    for (const m of markers) if (state.currentTime < m.time - 1) firedMarkers.current.delete(m.id);
  }, [state.currentTime, markers]);

  // Send heartbeats on pause, tab hide and unmount.
  useEffect(() => {
    if (!state.playing && state.started) sendHeartbeat(false, true);
  }, [state.playing, state.started, sendHeartbeat]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendHeartbeat(false, true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      sendHeartbeat(false, true);
    };
  }, [sendHeartbeat]);

  // Resume chip (auto-hides after 5 seconds)
  const showResume = state.ready && !!startAt && startAt > 5 && !resumeDismissed;
  useEffect(() => {
    if (!showResume) return;
    const t = setTimeout(() => setResumeDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [showResume]);

  // Autoplay
  useEffect(() => {
    if (autoPlay && state.ready && !state.started) void rawActions.play();
  }, [autoPlay, state.ready, state.started, rawActions]);

  /* --------------------------- controls visibility --------------------------- */
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
  }, []);

  // While playing (and no menu/scrub is active) the controls auto-hide; otherwise they are shown (derived below).
  useEffect(() => {
    if (!state.playing || menuOpen || scrubbing) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2800);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [state.playing, menuOpen, scrubbing]);
  const controlsShown = controlsVisible || !state.playing || menuOpen || scrubbing;

  // Any user-initiated playback action reveals the controls first.
  const actions = useMemo(
    () => ({
      ...rawActions,
      play: async () => {
        showControls();
        await rawActions.play();
      },
      toggle: () => {
        showControls();
        rawActions.toggle();
      },
      seek: (t: number) => {
        showControls();
        return rawActions.seek(t);
      },
      skip: (d: number) => {
        showControls();
        rawActions.skip(d);
      },
    }),
    [rawActions, showControls],
  );

  const showFlash = useCallback((icon: ReactNode, text?: string) => {
    flashKey.current += 1;
    setFlash({ icon, text, key: flashKey.current });
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
  }, [flash]);

  /* ------------------------------- keyboard ------------------------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const video = videoRef.current;
      if (!video) return;
      const key = e.key.toLowerCase();
      let handled = true;
      switch (key) {
        case " ":
        case "k":
          actions.toggle();
          showFlash(video.paused ? <Icon.Play /> : <Icon.Pause />);
          break;
        case "j":
          actions.skip(-10);
          showFlash(<Icon.Rewind10 />, "-10s");
          break;
        case "l":
          actions.skip(10);
          showFlash(<Icon.Forward10 />, "+10s");
          break;
        case "arrowleft":
          actions.skip(-5);
          showFlash(<Icon.Rewind10 />, "-5s");
          break;
        case "arrowright":
          actions.skip(5);
          showFlash(<Icon.Forward10 />, "+5s");
          break;
        case "arrowup":
          actions.setVolume(video.volume + 0.1);
          showFlash(<Icon.VolumeHigh />, `${Math.round(Math.min(1, video.volume + 0.1) * 100)}%`);
          break;
        case "arrowdown":
          actions.setVolume(video.volume - 0.1);
          showFlash(<Icon.VolumeLow />, `${Math.round(Math.max(0, video.volume - 0.1) * 100)}%`);
          break;
        case "m":
          actions.toggleMute();
          showFlash(video.muted ? <Icon.VolumeHigh /> : <Icon.VolumeMute />);
          break;
        case "f":
          void actions.toggleFullscreen();
          break;
        case "c":
          if (state.hasCaptions) actions.toggleCaptions();
          break;
        case "p":
          void actions.togglePip();
          break;
        case "t":
          onToggleTheater?.();
          break;
        case ",":
        case "<": {
          const i = PLAYBACK_RATES.indexOf(video.playbackRate);
          const next = PLAYBACK_RATES[Math.max(0, i - 1)]!;
          actions.setRate(next);
          showFlash(<Icon.Speed />, `${next}×`);
          break;
        }
        case ".":
        case ">": {
          const i = PLAYBACK_RATES.indexOf(video.playbackRate);
          const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, i + 1)]!;
          actions.setRate(next);
          showFlash(<Icon.Speed />, `${next}×`);
          break;
        }
        case "home":
          actions.seek(0);
          break;
        case "end":
          actions.seek(video.duration);
          break;
        default:
          if (/^[0-9]$/.test(key) && video.duration) {
            actions.seek((Number(key) / 10) * video.duration);
          } else handled = false;
      }
      if (handled) {
        e.preventDefault();
        showControls();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [actions, showControls, showFlash, state.hasCaptions, onToggleTheater]);

  /* ------------------------------ touch / click ------------------------------ */
  const lastTap = useRef<{ time: number; x: number } | null>(null);
  const handleSurfaceClick = (e: React.MouseEvent<HTMLElement>) => {
    // Double-tap on touch devices: left third rewinds, right third forwards.
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (lastTap.current && now - lastTap.current.time < 300 && Math.abs(lastTap.current.x - x) < 0.15) {
      lastTap.current = null;
      if (x < 0.33) {
        actions.skip(-10);
        showFlash(<Icon.Rewind10 />, "-10s");
      } else if (x > 0.66) {
        actions.skip(10);
        showFlash(<Icon.Forward10 />, "+10s");
      } else {
        void actions.toggleFullscreen();
      }
      return;
    }
    lastTap.current = { time: now, x };
    setTimeout(() => {
      if (lastTap.current && lastTap.current.time === now) {
        lastTap.current = null;
        actions.toggle();
        showFlash(videoRef.current?.paused ? <Icon.Pause /> : <Icon.Play />);
      }
    }, 300);
  };

  const showBigPlay = !state.started || (!state.playing && !state.ended && !state.waiting);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label={title ? `Video player: ${title}` : "Video player"}
      className={cn(
        "ll-player group/player relative isolate w-full overflow-hidden rounded-xl bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-accent",
        !state.fullscreen && "aspect-video",
        className,
      )}
      style={accentColor ? ({ "--player-accent": accentColor } as React.CSSProperties) : undefined}
      onMouseMove={showControls}
      onMouseLeave={() => state.playing && !menuOpen && setControlsVisible(false)}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        crossOrigin={captionsUrl ? "anonymous" : undefined}
        className="absolute inset-0 size-full object-contain"
        onClick={handleSurfaceClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {captionsUrl && <track kind="subtitles" src={captionsUrl} srcLang={captionsLang} label={captionsLabel} default={state.captionsOn} />}
        Your browser does not support HTML5 video.
      </video>

      {/* Title (top gradient) */}
      {title && (
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-3 transition-opacity", controlsShown ? "opacity-100" : "opacity-0")}>
          <p className="truncate text-sm font-medium drop-shadow">{title}</p>
        </div>
      )}

      {/* Big play button */}
      {showBigPlay && !state.error && (
        <button
          type="button"
          aria-label="Play"
          onClick={() => void actions.play()}
          className="absolute left-1/2 top-1/2 z-10 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--player-accent)] text-white shadow-lg transition hover:scale-105 sm:size-20"
        >
          <Icon.Play className="ml-1 size-8 sm:size-10" />
        </button>
      )}

      {/* Loading spinner */}
      {state.waiting && !state.error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Icon.Loader className="size-12 animate-spin-slow text-white/90" />
        </div>
      )}

      {/* Flash feedback (keyboard/gesture) */}
      {flash && (
        <div key={flash.key} className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-black/60 px-5 py-4 animate-scale-in [&>svg]:size-8">
          {flash.icon}
          {flash.text && <span className="text-xs font-medium">{flash.text}</span>}
        </div>
      )}

      {/* Resume chip */}
      {showResume && (
        <div className="absolute bottom-20 left-3 z-10 flex items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-xs shadow animate-fade-in">
          <Icon.Clock className="size-4" /> Resumed from {formatTime(startAt ?? 0)}
          <button
            type="button"
            className="ml-1 font-medium text-[var(--player-accent)] hover:underline"
            onClick={() => {
              actions.seek(0);
              setResumeDismissed(true);
            }}
          >
            Start over
          </button>
        </div>
      )}

      {/* Skip blocked notice */}
      {skipBlocked && (
        <div className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-2 text-xs shadow animate-fade-in">
          <Icon.Lock className="mr-1 inline size-3.5" /> Skipping ahead is disabled for this lesson
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <Icon.AlertTriangle className="size-10 text-warning" />
          <p className="max-w-sm text-sm">{state.error}</p>
          <button type="button" onClick={actions.retry} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25">
            Try again
          </button>
        </div>
      )}

      {/* End screen */}
      {state.ended && !loop && !state.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/75 px-6 text-center animate-fade-in">
          <p className="text-sm text-white/80">{title ? `You finished “${title}”` : "Video complete"}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                actions.seek(0);
                void actions.play();
              }}
              className="flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25"
            >
              <Icon.Replay className="size-4" /> Replay
            </button>
            {onNext && (
              <button type="button" onClick={onNext} className="flex items-center gap-2 rounded-lg bg-[var(--player-accent)] px-4 py-2 text-sm font-medium hover:brightness-110">
                {nextLabel} <Icon.ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {overlay && <div className="absolute inset-0 z-30">{overlay}</div>}

      <ControlBar
        state={state}
        actions={actions}
        chapters={chapters}
        markers={markers}
        maxSeekable={preventSkipping ? Math.max(maxPos, state.currentTime) : undefined}
        visible={controlsShown}
        onMenuOpenChange={setMenuOpen}
        onMarkerClick={(m) => {
          if (actions.seek(m.time)) onMarker?.(m);
        }}
        theater={theater}
        onToggleTheater={onToggleTheater}
        loop={loop}
        onToggleLoop={() => setLoop((v) => !v)}
        onScrubStart={() => setScrubbing(true)}
        onScrubEnd={() => setScrubbing(false)}
      />
    </div>
  );
}
