"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VideoSource } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { AUTO_QUALITY, buildQualityOptions, pickAutoQuality, type QualityOption } from "@/lib/media/sources";
import { Icon } from "@/components/ui/icons";
import { loadPlayerPrefs, savePlayerPrefs, useVideoPlayer } from "./use-video-player";
import { ControlBar, PLAYBACK_RATES } from "./controls";
import type { SeekChapter, SeekMarker } from "./seek-bar";
import { useMediaSource } from "./use-media-source";
import { bucketOf, useSeekThumbnails } from "./use-seek-thumbnails";
import { ThumbnailPreview } from "./thumbnail-preview";
import { Watermark } from "./watermark";
import { ShortcutsOverlay, playerShortcuts } from "./shortcuts-overlay";
import { EndScreen } from "./end-screen";
import { useMiniPlayer } from "./use-mini-player";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { DockReturnIcon } from "./player-icons";

export interface HeartbeatPayload {
  /** Current playback position in seconds. */
  position: number;
  /** Seconds actually watched since the previous heartbeat. */
  watchedDelta: number;
  /** Highest position reached in this session. */
  maxPosition: number;
  duration: number;
  ended: boolean;
  /** Ranges [start, end) in seconds played since the previous heartbeat (retention analytics). */
  ranges: [number, number][];
}

export interface PlayerWatermarkOptions {
  /** Usually the viewer's email address. */
  text: string;
  /** 0.05 – 0.5 */
  opacity: number;
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

  /* ----- round 2 ----- */
  /** Alternative renditions for the Quality menu (the main `src` stays the default). */
  sources?: VideoSource[];
  /** Label of the main `src` in the Quality menu (default "Original"). */
  sourceLabel?: string;
  /** Lesson the video belongs to: scopes signed-URL refreshes of protected uploads. */
  mediaContext?: { lessonId?: string };
  /**
   * Viewer watermark. `null` turns it off; when omitted, the server's
   * setting is used for protected uploads the player signs itself.
   */
  watermark?: PlayerWatermarkOptions | null;
  /** Preview frames on the seek bar (defaults to the server setting for self-signed uploads, else off). */
  seekThumbnails?: boolean;
  /** With `onNext`, count down 5 seconds on the end screen and continue automatically. */
  autoplayNext?: boolean;
  /** Title of the next item, shown on the countdown. */
  nextTitle?: string;
  /** Text before the countdown number: "<label> in 5…" (default "Next lesson"). */
  countdownLabel?: string;
  /** Dock into a floating mini-player when scrolled out of view while playing (lesson pages). */
  miniPlayer?: boolean;
}

type Range = [number, number];

const round2 = (n: number) => Math.round(n * 100) / 100;

function connectionInfo(): { effectiveType?: string; saveData?: boolean } {
  if (typeof navigator === "undefined") return {};
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  return conn ? { effectiveType: conn.effectiveType, saveData: conn.saveData } : {};
}

/**
 * A fully custom HTML5 video player: no third-party player, no iframes.
 * Supports keyboard shortcuts (with an overlay), chapters, markers, captions,
 * PiP, fullscreen, theater mode, playback speed, quality renditions, resume,
 * watch tracking with retention ranges, anti-skip, signed-URL refresh for
 * protected uploads, a moving viewer watermark, seek-bar preview frames,
 * autoplay-next countdown and a docking mini-player.
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
  sources,
  sourceLabel,
  mediaContext,
  watermark,
  seekThumbnails,
  autoplayNext,
  nextTitle,
  countdownLabel = "Next lesson",
  miniPlayer,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [loop, setLoop] = useState(false);
  const [flash, setFlash] = useState<{ icon: ReactNode; text?: string; key: number } | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [skipBlocked, setSkipBlocked] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashKey = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  /* ------------------------------ quality ------------------------------ */
  const qualityOptions = useMemo(() => buildQualityOptions(src, sources, sourceLabel), [src, sources, sourceLabel]);
  const hasQualityChoice = qualityOptions.length > 1;
  const [quality, setQuality] = useState<{ pref: string; activeId: string | null }>(() => {
    if (!hasQualityChoice) return { pref: AUTO_QUALITY, activeId: "main" };
    const stored = typeof window === "undefined" ? undefined : loadPlayerPrefs().quality;
    const match = stored && stored !== AUTO_QUALITY ? qualityOptions.find((o) => o.label === stored) : undefined;
    return match ? { pref: match.id, activeId: match.id } : { pref: AUTO_QUALITY, activeId: null };
  });
  const activeOption: QualityOption | null = hasQualityChoice
    ? quality.activeId === null
      ? null
      : (qualityOptions.find((o) => o.id === quality.activeId) ?? qualityOptions[0]!)
    : qualityOptions[0]!;

  const pickAuto = useCallback((): QualityOption => {
    const width = containerRef.current?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1280);
    return pickAutoQuality(qualityOptions, { ...connectionInfo(), width, devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1 });
  }, [qualityOptions]);

  // "Auto": choose a rendition once the player can measure itself.
  useEffect(() => {
    if (quality.activeId !== null || !hasQualityChoice) return;
    const raf = window.requestAnimationFrame(() => setQuality((q) => (q.activeId !== null ? q : { ...q, activeId: pickAuto().id })));
    return () => window.cancelAnimationFrame(raf);
  }, [quality.activeId, hasQualityChoice, pickAuto]);

  const selectQuality = useCallback(
    (id: string) => {
      if (id === AUTO_QUALITY) {
        savePlayerPrefs({ quality: AUTO_QUALITY });
        setQuality({ pref: AUTO_QUALITY, activeId: pickAuto().id });
        return;
      }
      const option = qualityOptions.find((o) => o.id === id);
      if (!option) return;
      savePlayerPrefs({ quality: option.label });
      setQuality({ pref: option.id, activeId: option.id });
    },
    [qualityOptions, pickAuto],
  );

  /* --------------------------- protected source --------------------------- */
  const media = useMediaSource(activeOption?.src ?? "", mediaContext?.lessonId);
  const watermarkOptions = watermark !== undefined ? watermark : (media.config?.watermark ?? null);
  const thumbnailsOn = seekThumbnails ?? media.config?.seekThumbnails ?? false;

  // Watch tracking
  const watchedAccum = useRef(0);
  const rangesRef = useRef<Range[]>([]);
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
        ranges: rangesRef.current.map(([a, b]) => [round2(a), round2(b)] as Range),
      };
      watchedAccum.current = 0;
      rangesRef.current = [];
      callbacks.current.onHeartbeat?.(payload);
    },
    [heartbeatInterval],
  );

  const recordRange = (time: number, delta: number) => {
    const start = time - delta;
    const ranges = rangesRef.current;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last[1] - start) < 0.75) last[1] = time;
    else ranges.push([Math.max(0, start), time]);
    if (ranges.length > 48) ranges.splice(0, ranges.length - 48);
  };

  // Error recovery for protected uploads (expired or rejected signed URL mid-playback).
  const recovery = useRef({ attempts: 0, since: 0 });
  const appliedUrl = useRef<string | null>(null);
  const mediaRef = useRef(media);
  const playingRef = useRef(false);
  const actionsRef = useRef<{ beginSourceSwap: (o?: { time?: number; play?: boolean }) => void } | null>(null);
  useEffect(() => {
    mediaRef.current = media;
  });

  const { state, actions: rawActions } = useVideoPlayer(videoRef, containerRef, {
    startAt,
    onTick: (time, delta) => {
      watchedAccum.current += delta;
      recordRange(time, delta);
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
      const duration = videoRef.current?.duration ?? maxPosition.current;
      const last = rangesRef.current[rangesRef.current.length - 1];
      if (last && Number.isFinite(duration) && duration - last[1] < 1.5) last[1] = duration;
      maxPosition.current = duration;
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
    onMediaError: () => {
      const current = mediaRef.current;
      if (!current.isProtected) return false;
      const now = Date.now();
      if (now - recovery.current.since > 60_000) recovery.current = { attempts: 0, since: now };
      if (recovery.current.attempts >= 2) return false;
      recovery.current.attempts += 1;
      const video = videoRef.current;
      actionsRef.current?.beginSourceSwap({ time: video?.currentTime ?? 0, play: playingRef.current });
      void current.refresh().then((url) => {
        if (!url) {
          setRecoveryFailed(true);
          return;
        }
        // Same URL (signed within the same second): reload it explicitly.
        if (url === appliedUrl.current) videoRef.current?.load();
      });
      return true;
    },
  });
  useEffect(() => {
    actionsRef.current = rawActions;
    playingRef.current = state.playing;
  });

  // Point the <video> at the current (signed) URL; later changes keep time and play state.
  useEffect(() => {
    const video = videoRef.current;
    const url = media.url;
    if (!video || !url || appliedUrl.current === url) return;
    if (appliedUrl.current !== null) rawActions.beginSourceSwap();
    appliedUrl.current = url;
    video.src = url;
  }, [media.url, rawActions]);

  // Stop downloading when the player goes away.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      appliedUrl.current = null;
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, []);

  /* ------------------------------ mini-player ------------------------------ */
  const blocked = state.fullscreen || state.pip || !!overlay || shortcutsOpen;
  const mini = useMiniPlayer({ enabled: !!miniPlayer, slotRef, playing: state.playing, blocked });
  const docked = mini.docked;
  const { onPlay: onMiniPlay } = mini;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !miniPlayer) return;
    video.addEventListener("play", onMiniPlay);
    return () => video.removeEventListener("play", onMiniPlay);
  }, [miniPlayer, onMiniPlay]);

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
    if (!markers?.length || state.swapping) return;
    for (const m of markers) if (state.currentTime < m.time - 1) firedMarkers.current.delete(m.id);
  }, [state.currentTime, state.swapping, markers]);

  // Send heartbeats on pause, tab hide and unmount.
  useEffect(() => {
    if (!state.playing && state.started && !state.swapping) sendHeartbeat(false, true);
  }, [state.playing, state.started, state.swapping, sendHeartbeat]);

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
  const showResume = state.ready && !!startAt && startAt > 5 && !resumeDismissed && !docked;
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

  const retry = useCallback(() => {
    setRecoveryFailed(false);
    recovery.current = { attempts: 0, since: Date.now() };
    if (!media.isProtected) {
      rawActions.retry();
      return;
    }
    const video = videoRef.current;
    rawActions.beginSourceSwap({ time: video?.currentTime ?? 0, play: true });
    void media.refresh().then((url) => {
      if (!url) {
        setRecoveryFailed(true);
        return;
      }
      if (url === appliedUrl.current) videoRef.current?.load();
    });
  }, [media, rawActions]);

  // Any user-initiated playback action reveals the controls first.
  const actions = useMemo(
    () => ({
      ...rawActions,
      retry,
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
    [rawActions, showControls, retry],
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

  const pipAllowed = !watermarkOptions;
  const fullscreenAllowed = !docked;

  /* ------------------------------- keyboard ------------------------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const video = videoRef.current;
      if (!video) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (shortcutsOpen) return;
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
          if (fullscreenAllowed) void actions.toggleFullscreen();
          break;
        case "c":
          if (state.hasCaptions) actions.toggleCaptions();
          break;
        case "p":
          if (pipAllowed) void actions.togglePip();
          break;
        case "t":
          onToggleTheater?.();
          break;
        case ",":
        case "<": {
          const i = PLAYBACK_RATES.indexOf(video.playbackRate);
          const next = PLAYBACK_RATES[Math.max(0, (i === -1 ? PLAYBACK_RATES.indexOf(1) : i) - 1)]!;
          actions.setRate(next);
          showFlash(<Icon.Speed />, `${next}×`);
          break;
        }
        case ".":
        case ">": {
          const i = PLAYBACK_RATES.indexOf(video.playbackRate);
          const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, (i === -1 ? PLAYBACK_RATES.indexOf(1) : i) + 1)]!;
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
  }, [actions, showControls, showFlash, state.hasCaptions, onToggleTheater, shortcutsOpen, pipAllowed, fullscreenAllowed]);

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
      } else if (fullscreenAllowed) {
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

  /* ------------------------------ seek previews ------------------------------ */
  const thumbs = useSeekThumbnails({ src: media.url, enabled: thumbnailsOn && !docked });
  const requestThumb = thumbs.request;
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const onHoverTime = useCallback(
    (time: number | null) => {
      setHoverTime(time);
      if (time !== null) requestThumb(time);
    },
    [requestThumb],
  );
  const preview =
    thumbnailsOn && !docked && (thumbs.status === "loading" || thumbs.status === "ready") ? (
      <ThumbnailPreview frame={thumbs.frame} stale={!!thumbs.frame && hoverTime !== null && thumbs.frame.bucket !== bucketOf(hoverTime)} />
    ) : undefined;

  /* -------------------------------- render -------------------------------- */
  const mediaMessage = media.status === "denied" || (media.status === "error" && !media.url) ? media.message : null;
  const errorMessage = mediaMessage ?? (recoveryFailed ? (media.message ?? "The video link expired and could not be renewed.") : state.error);
  const resolving = media.status === "resolving" && !errorMessage;
  const showBigPlay = !resolving && !errorMessage && (!state.started || (!state.playing && !state.ended && !state.waiting));
  const shortcutGroups = shortcutsOpen
    ? playerShortcuts({ captions: state.hasCaptions, pip: pipAllowed && typeof document !== "undefined" && !!document.pictureInPictureEnabled, theater: !!onToggleTheater, fullscreen: true })
    : [];

  const player = (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label={title ? `Video player: ${title}` : "Video player"}
      className={cn(
        "ll-player group/player relative isolate w-full overflow-hidden bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-accent",
        !state.fullscreen && "aspect-video",
        docked
          ? "fixed bottom-20 right-3 z-35 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg shadow-pop ring-1 ring-white/10 lg:bottom-4 lg:right-4"
          : "rounded-xl",
        docked && !reducedMotion && "animate-scale-in",
        className,
        docked && "min-h-0",
      )}
      style={accentColor ? ({ "--player-accent": accentColor } as React.CSSProperties) : undefined}
      onMouseMove={showControls}
      onMouseLeave={() => state.playing && !menuOpen && setControlsVisible(false)}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        data-ll-main-video=""
        poster={poster}
        preload="metadata"
        playsInline
        crossOrigin={captionsUrl ? "anonymous" : undefined}
        className="absolute inset-0 size-full object-contain"
        onClick={handleSurfaceClick}
        onContextMenu={(e) => e.preventDefault()}
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture={!pipAllowed || undefined}
      >
        {captionsUrl && <track kind="subtitles" src={captionsUrl} srcLang={captionsLang} label={captionsLabel} default={state.captionsOn} />}
        Your browser does not support HTML5 video.
      </video>

      {/* Hidden second video that renders seek-bar previews. */}
      {thumbs.active && (
        <video
          ref={thumbs.videoRef}
          muted
          playsInline
          preload="metadata"
          crossOrigin={thumbs.crossOrigin}
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 -z-10 size-px opacity-0"
        />
      )}

      {watermarkOptions && <Watermark text={watermarkOptions.text} opacity={watermarkOptions.opacity} reducedMotion={reducedMotion} />}

      {/* Title (top gradient) */}
      {title && !docked && (
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-black/70 to-transparent px-4 pb-8 pt-3 transition-opacity", controlsShown ? "opacity-100" : "opacity-0")}>
          <p className="truncate text-sm font-medium drop-shadow">{title}</p>
        </div>
      )}

      {/* Mini-player buttons */}
      {docked && (
        <div className={cn("absolute right-1.5 top-1.5 z-30 flex items-center gap-1 transition-opacity", controlsShown ? "opacity-100" : "opacity-0 focus-within:opacity-100")}>
          <button
            type="button"
            onClick={() => mini.returnToSlot(!reducedMotion)}
            aria-label="Back to the lesson video"
            title="Back to the lesson video"
            className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white/90 hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <DockReturnIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              rawActions.pause();
              mini.close();
            }}
            aria-label="Close mini player"
            title="Close mini player"
            className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white/90 hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Icon.X className="size-4" />
          </button>
        </div>
      )}

      {/* Big play button */}
      {showBigPlay && (
        <button
          type="button"
          aria-label="Play"
          onClick={() => void actions.play()}
          className={cn(
            "absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-(--player-accent) text-white shadow-lg transition hover:scale-105",
            docked ? "size-12" : "size-16 sm:size-20",
          )}
        >
          <Icon.Play className={docked ? "ml-0.5 size-6" : "ml-1 size-8 sm:size-10"} />
        </button>
      )}

      {/* Loading spinner */}
      {(resolving || state.waiting) && !errorMessage && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
          <Icon.Loader className="size-12 animate-spin-slow text-white/90" />
          <span className="sr-only">Loading video</span>
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
            className="ml-1 font-medium text-(--player-accent) hover:underline"
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
      {errorMessage && (
        <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <Icon.AlertTriangle className={docked ? "size-6 text-warning" : "size-10 text-warning"} />
          <p className="max-w-sm text-sm">{errorMessage}</p>
          {media.status !== "denied" && (
            <button type="button" onClick={actions.retry} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25">
              Try again
            </button>
          )}
        </div>
      )}

      {/* End screen */}
      {state.ended && !loop && !errorMessage && (
        <EndScreen
          title={title}
          compact={docked}
          onReplay={() => {
            actions.seek(0);
            void actions.play();
          }}
          onNext={onNext}
          nextLabel={nextLabel}
          nextTitle={nextTitle}
          countdownLabel={countdownLabel}
          autoplay={!!autoplayNext && !!onNext}
          reducedMotion={reducedMotion}
        />
      )}

      {overlay && <div className="absolute inset-0 z-30">{overlay}</div>}

      {shortcutsOpen && <ShortcutsOverlay groups={shortcutGroups} onClose={() => setShortcutsOpen(false)} />}

      <ControlBar
        state={state}
        actions={actions}
        chapters={chapters}
        markers={markers}
        maxSeekable={preventSkipping ? Math.max(maxPos, state.currentTime) : undefined}
        visible={controlsShown && !shortcutsOpen}
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
        compact={docked}
        allowPip={pipAllowed}
        quality={
          hasQualityChoice
            ? { options: qualityOptions, selected: quality.pref, playingId: activeOption?.id ?? quality.pref, onSelect: selectQuality }
            : undefined
        }
        onShowShortcuts={() => setShortcutsOpen(true)}
        onHoverTime={thumbnailsOn ? onHoverTime : undefined}
        preview={preview}
      />
    </div>
  );

  if (!miniPlayer) return player;

  return (
    <div ref={slotRef} className={cn("relative w-full", docked && "aspect-video rounded-xl bg-surface-2")}>
      {docked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-center text-sm text-ink-muted">
          <DockReturnIcon className="size-6 text-ink-faint" />
          Playing in the mini player
        </div>
      )}
      {player}
    </div>
  );
}
