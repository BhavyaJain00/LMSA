"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { clamp } from "@/lib/utils";

export interface BufferedRange {
  start: number;
  end: number;
}

export interface PlayerState {
  playing: boolean;
  started: boolean;
  ended: boolean;
  waiting: boolean;
  ready: boolean;
  error: string | null;
  /** MediaError code of the last error (1 aborted, 2 network, 3 decode, 4 unsupported/not found). */
  errorCode: number | null;
  currentTime: number;
  duration: number;
  buffered: BufferedRange[];
  volume: number;
  muted: boolean;
  rate: number;
  fullscreen: boolean;
  pip: boolean;
  captionsOn: boolean;
  hasCaptions: boolean;
  seeking: boolean;
  /** A new source (quality change or refreshed signed URL) is loading; time and play state will be restored. */
  swapping: boolean;
}

const PREFS_KEY = "ll-player-prefs";

export interface PlayerPrefs {
  volume?: number;
  muted?: boolean;
  rate?: number;
  captions?: boolean;
  /** Preferred quality: "auto" or a rendition label such as "720p". */
  quality?: string;
}

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as PlayerPrefs) : {};
  } catch {
    return {};
  }
}

export function savePlayerPrefs(patch: PlayerPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPlayerPrefs(), ...patch }));
  } catch {
    /* storage unavailable (private mode) — preferences are simply not remembered */
  }
}

export interface UseVideoPlayerOptions {
  /** Called on every timeupdate with the seconds of *real* playback since the last call. */
  onTick?: (currentTime: number, watchedDelta: number) => void;
  onEnded?: () => void;
  /** Return false to cancel a seek (used for "prevent skipping"). */
  canSeekTo?: (time: number) => boolean;
  startAt?: number;
  /**
   * Called when the media element reports an error. Return true when the
   * error is being recovered from (e.g. an expired signed URL is refreshed):
   * the error screen is then not shown.
   */
  onMediaError?: (code: number | undefined) => boolean;
}

interface PendingRestore {
  time: number;
  play: boolean;
}

const ERROR_MESSAGES: Record<number, string> = {
  1: "Playback was interrupted.",
  2: "A network error interrupted the video.",
  3: "The video could not be decoded.",
  4: "This video format is not supported or the file could not be found.",
};

/**
 * Wraps a <video> element's imperative API in React state.
 * All custom controls talk to the video only through the returned actions.
 */
export function useVideoPlayer(videoRef: RefObject<HTMLVideoElement | null>, containerRef: RefObject<HTMLDivElement | null>, opts: UseVideoPlayerOptions = {}) {
  const [state, setState] = useState<PlayerState>({
    playing: false,
    started: false,
    ended: false,
    waiting: false,
    ready: false,
    error: null,
    errorCode: null,
    currentTime: 0,
    duration: 0,
    buffered: [],
    volume: 1,
    muted: false,
    rate: 1,
    fullscreen: false,
    pip: false,
    captionsOn: false,
    hasCaptions: false,
    seeking: false,
    swapping: false,
  });
  const lastTimeRef = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const startAtApplied = useRef(false);
  const restoreRef = useRef<PendingRestore | null>(null);

  const patch = useCallback((p: Partial<PlayerState>) => setState((s) => ({ ...s, ...p })), []);

  /* --------------------------- video event wiring --------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const prefs = loadPlayerPrefs();
    video.volume = typeof prefs.volume === "number" ? clamp(prefs.volume, 0, 1) : 1;
    video.muted = prefs.muted ?? false;
    const rate = typeof prefs.rate === "number" && prefs.rate >= 0.25 && prefs.rate <= 4 ? prefs.rate : 1;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    patch({ volume: video.volume, muted: video.muted, rate: video.playbackRate, captionsOn: prefs.captions ?? false });

    const readBuffered = () => {
      const ranges: BufferedRange[] = [];
      for (let i = 0; i < video.buffered.length; i++) ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
      return ranges;
    };

    const onLoadedMetadata = () => {
      patch({ duration: video.duration || 0, ready: true, error: null, errorCode: null, hasCaptions: video.textTracks.length > 0 });
      const restore = restoreRef.current;
      if (restore) {
        restoreRef.current = null;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const target = duration ? clamp(restore.time, 0, Math.max(0, duration - 0.25)) : restore.time;
        if (target > 0) video.currentTime = target;
        lastTimeRef.current = target;
        patch({ swapping: false, currentTime: target, waiting: restore.play });
        if (restore.play) void video.play().catch(() => patch({ waiting: false }));
        startAtApplied.current = true;
        return;
      }
      const startAt = optsRef.current.startAt ?? 0;
      if (!startAtApplied.current && startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 3) {
        video.currentTime = startAt;
        lastTimeRef.current = startAt;
      }
      startAtApplied.current = true;
    };
    const onTimeUpdate = () => {
      const t = video.currentTime;
      if (restoreRef.current) {
        // A new source is loading from 0: keep showing (and counting from) the restored position.
        lastTimeRef.current = restoreRef.current.time;
        return;
      }
      const delta = t - lastTimeRef.current;
      // Count as "watched" only when playing forward at a natural pace (ignores seeks).
      if (!video.paused && !video.seeking && delta > 0 && delta < 2 * Math.max(1, video.playbackRate)) {
        optsRef.current.onTick?.(t, delta);
      }
      lastTimeRef.current = t;
      patch({ currentTime: t, buffered: readBuffered() });
    };
    const onPlay = () => patch({ playing: true, started: true, ended: false });
    const onPause = () => patch({ playing: false });
    const onEnded = () => {
      patch({ playing: false, ended: true });
      optsRef.current.onEnded?.();
    };
    const onWaiting = () => patch({ waiting: true });
    const onPlaying = () => patch({ waiting: false });
    const onCanPlay = () => patch({ waiting: false, ready: true });
    const onProgress = () => patch({ buffered: readBuffered() });
    const onVolume = () => patch({ volume: video.volume, muted: video.muted });
    const onRate = () => patch({ rate: video.playbackRate });
    const onSeeking = () => patch({ seeking: true });
    const onSeeked = () => {
      lastTimeRef.current = video.currentTime;
      patch({ seeking: false, currentTime: video.currentTime, ended: false });
    };
    const onError = () => {
      // Errors of a cleared or replaced source are not the viewer's problem.
      if (!video.getAttribute("src")) return;
      const code = video.error?.code;
      if (optsRef.current.onMediaError?.(code)) {
        patch({ waiting: true, error: null, errorCode: code ?? null });
        return;
      }
      restoreRef.current = null;
      patch({ error: ERROR_MESSAGES[code ?? 0] ?? "The video could not be played.", errorCode: code ?? null, waiting: false, playing: false, swapping: false });
    };
    const onDurationChange = () => patch({ duration: video.duration || 0 });
    // Caption tracks can arrive after the metadata (e.g. built from a transcript that loads later).
    const onTracksChange = () => patch({ hasCaptions: video.textTracks.length > 0 });
    const onEnterPip = () => patch({ pip: true });
    const onLeavePip = () => patch({ pip: false });

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("progress", onProgress);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ratechange", onRate);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    video.textTracks.addEventListener("addtrack", onTracksChange);
    video.textTracks.addEventListener("removetrack", onTracksChange);
    if (video.readyState >= 1) onLoadedMetadata();

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
      video.textTracks.removeEventListener("addtrack", onTracksChange);
      video.textTracks.removeEventListener("removetrack", onTracksChange);
    };
  }, [videoRef, patch]);

  /* ------------------------------ fullscreen ------------------------------ */
  useEffect(() => {
    const onChange = () => patch({ fullscreen: !!document.fullscreenElement && document.fullscreenElement === containerRef.current });
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [containerRef, patch]);

  /* ------------------------------- captions ------------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i]!;
      track.mode = state.captionsOn ? "showing" : "hidden";
    }
  }, [state.captionsOn, state.hasCaptions, videoRef]);

  /* -------------------------------- actions -------------------------------- */
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
    } catch {
      /* autoplay policies — ignore */
    }
  }, [videoRef]);

  const pause = useCallback(() => videoRef.current?.pause(), [videoRef]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void play();
    else pause();
  }, [videoRef, play, pause]);

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(time)) return false;
      const target = clamp(time, 0, video.duration || 0);
      if (optsRef.current.canSeekTo && !optsRef.current.canSeekTo(target)) return false;
      video.currentTime = target;
      lastTimeRef.current = target;
      patch({ currentTime: target, ended: false });
      return true;
    },
    [videoRef, patch],
  );

  const skip = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seek(video.currentTime + delta);
    },
    [videoRef, seek],
  );

  const setVolume = useCallback(
    (v: number) => {
      const video = videoRef.current;
      if (!video) return;
      const vol = clamp(v, 0, 1);
      video.volume = vol;
      video.muted = vol === 0;
      savePlayerPrefs({ volume: vol, muted: vol === 0 });
    },
    [videoRef],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.5;
    } else {
      video.muted = true;
    }
    savePlayerPrefs({ muted: video.muted, volume: video.volume });
  }, [videoRef]);

  const setRate = useCallback(
    (rate: number) => {
      const video = videoRef.current;
      if (!video) return;
      // defaultPlaybackRate survives source changes (quality switches, refreshed URLs).
      video.defaultPlaybackRate = rate;
      video.playbackRate = rate;
      savePlayerPrefs({ rate });
    },
    [videoRef],
  );

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // iOS Safari: fall back to the native video fullscreen.
      const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      v?.webkitEnterFullscreen?.();
    }
  }, [containerRef, videoRef]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* unsupported */
    }
  }, [videoRef]);

  const toggleCaptions = useCallback(() => {
    setState((s) => {
      savePlayerPrefs({ captions: !s.captionsOn });
      return { ...s, captionsOn: !s.captionsOn };
    });
  }, []);

  /**
   * Prepare for a source change (the caller then updates the <video> src):
   * the current position and play state are restored once the new source
   * has loaded its metadata.
   */
  const beginSourceSwap = useCallback(
    (override?: Partial<PendingRestore>) => {
      const video = videoRef.current;
      if (!video) return;
      const hadSource = !!video.getAttribute("src") && video.readyState >= 1;
      const current = restoreRef.current;
      const time = override?.time ?? current?.time ?? (hadSource ? video.currentTime : 0);
      const playing = override?.play ?? current?.play ?? (!video.paused && !video.ended);
      restoreRef.current = { time, play: playing };
      patch({ swapping: true, waiting: playing, error: null, errorCode: null, ended: false });
    },
    [videoRef, patch],
  );

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    restoreRef.current = { time: video.currentTime || lastTimeRef.current, play: true };
    patch({ error: null, errorCode: null, waiting: true, swapping: true });
    video.load();
  }, [videoRef, patch]);

  const actions = useMemo(
    () => ({ play, pause, toggle, seek, skip, setVolume, toggleMute, setRate, toggleFullscreen, togglePip, toggleCaptions, retry, beginSourceSwap }),
    [play, pause, toggle, seek, skip, setVolume, toggleMute, setRate, toggleFullscreen, togglePip, toggleCaptions, retry, beginSourceSwap],
  );

  return { state, actions };
}

export type PlayerActions = ReturnType<typeof useVideoPlayer>["actions"];
