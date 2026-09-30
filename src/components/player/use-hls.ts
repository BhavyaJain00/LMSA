"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { initialEstimate } from "./hls/abr";
import { HlsEngine, type HlsFatalError, type HlsLevel, type HlsStats } from "./hls/engine";

const BANDWIDTH_KEY = "ll-hls-bandwidth";

function savedBandwidth(): number | null {
  try {
    const value = Number(localStorage.getItem(BANDWIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveBandwidth(bps: number) {
  try {
    if (Number.isFinite(bps) && bps > 0) localStorage.setItem(BANDWIDTH_KEY, String(Math.round(bps)));
  } catch {
    /* storage unavailable */
  }
}

function connection(): { downlink?: number; saveData?: boolean } {
  if (typeof navigator === "undefined") return {};
  return (navigator as Navigator & { connection?: { downlink?: number; saveData?: boolean } }).connection ?? {};
}

export interface UseHlsOptions {
  /** Run the MSE engine (false: native HLS, progressive playback or not decided yet). */
  enabled: boolean;
  /** Identity of the stream (the unsigned master URL): a new value starts a new engine. */
  streamKey: string;
  /** Current (signed) master URL; null while it is being signed. */
  masterUrl: string | null;
  /** Re-sign the master URL (after a 401/403). */
  refresh: () => Promise<string | null>;
  /** Where to start downloading (resume position). */
  startPosition: () => number;
  /** Label of a quality the viewer pinned earlier ("720p"), or null for Auto. */
  preferredLabel: () => string | null;
  /** Rendered player height in device pixels. */
  capHeight: () => number | undefined;
  onFatal: (error: HlsFatalError) => void;
}

export interface HlsPlayback {
  levels: HlsLevel[];
  /** Level of the picture on screen (-1 until known). */
  playingLevel: number;
  /** Pinned level, or -1 for Auto. */
  manualLevel: number;
  setLevel: (index: number) => void;
  getStats: () => HlsStats | null;
}

/**
 * Runs the hand-written HLS engine on the player's <video> element while
 * `enabled`, keeps it pointed at the latest signed master URL (a scheduled
 * token refresh swaps URLs without interrupting playback) and exposes the
 * quality levels for the Quality menu.
 */
export function useHls(videoRef: RefObject<HTMLVideoElement | null>, opts: UseHlsOptions): HlsPlayback {
  const engineRef = useRef<HlsEngine | null>(null);
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [playingLevel, setPlayingLevel] = useState(-1);
  const [manualLevel, setManualLevel] = useState(-1);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const hasUrl = !!opts.masterUrl;
  const { enabled, streamKey } = opts;

  useEffect(() => {
    const video = videoRef.current;
    const url = optsRef.current.masterUrl;
    if (!enabled || !video || !url) return;
    const conn = connection();
    const engine = new HlsEngine({
      video,
      masterUrl: url,
      refreshMasterUrl: () => optsRef.current.refresh(),
      startPosition: optsRef.current.startPosition(),
      initialBandwidth: initialEstimate(savedBandwidth(), conn.downlink),
      saveData: conn.saveData,
      capHeight: () => optsRef.current.capHeight(),
      startLevel: (list) => {
        const label = optsRef.current.preferredLabel();
        const pinned = label ? list.findIndex((l) => l.label === label) : -1;
        setManualLevel(pinned);
        return pinned;
      },
      onLevels: (list) => setLevels(list),
      onLevelChange: (level) => setPlayingLevel(level),
      onFatal: (error) => optsRef.current.onFatal(error),
    });
    engineRef.current = engine;
    void engine.start();
    return () => {
      saveBandwidth(engine.getBandwidthEstimate());
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
      setLevels([]);
      setPlayingLevel(-1);
    };
    // The engine follows URL refreshes itself (below); only a new stream restarts it.
  }, [enabled, streamKey, hasUrl, videoRef]);

  // Scheduled re-signing of the master URL: hand the new URL to the running engine.
  useEffect(() => {
    if (opts.masterUrl) engineRef.current?.updateMasterUrl(opts.masterUrl);
  }, [opts.masterUrl]);

  const setLevel = useCallback((index: number) => {
    setManualLevel(index);
    engineRef.current?.setLevel(index);
  }, []);

  const getStats = useCallback(() => engineRef.current?.getStats() ?? null, []);

  return { levels, playingLevel, manualLevel, setLevel, getStats };
}
