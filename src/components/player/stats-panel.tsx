"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { formatBytes } from "@/lib/utils";
import { backBufferLength, bufferInfo, toRanges } from "./hls/buffer";
import type { HlsStats } from "./hls/engine";

export type PlaybackMode = "mse" | "native" | "progressive";

const MODE_LABEL: Record<PlaybackMode, string> = {
  mse: "Adaptive HLS (built-in engine)",
  native: "Adaptive HLS (browser)",
  progressive: "Progressive download",
};

interface Snapshot {
  resolution: string;
  viewport: string;
  bufferAhead: number;
  backBuffer: number;
  dropped: number;
  frames: number;
  hls: HlsStats | null;
}

function kbps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(2)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

function read(video: HTMLVideoElement | null, container: HTMLElement | null, getHls: () => HlsStats | null): Snapshot | null {
  if (!video) return null;
  const ranges = toRanges(video.buffered);
  const info = bufferInfo(ranges, video.currentTime);
  const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return {
    resolution: video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : "—",
    viewport: container ? `${container.clientWidth}×${container.clientHeight} @${dpr}x` : "—",
    bufferAhead: info.ahead,
    backBuffer: backBufferLength(ranges, video.currentTime),
    dropped: quality?.droppedVideoFrames ?? 0,
    frames: quality?.totalVideoFrames ?? 0,
    hls: getHls(),
  };
}

/**
 * "Stats for nerds": playback mode, rendition, estimated bandwidth, buffer
 * health and dropped frames, refreshed twice a second while open.
 */
export function StatsPanel({
  mode,
  videoRef,
  containerRef,
  getHls,
  onClose,
}: {
  mode: PlaybackMode;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  getHls: () => HlsStats | null;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const getRef = useRef(getHls);

  // Opened from the settings menu: move focus in, and give it back when the panel closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    getRef.current = getHls;
  });

  useEffect(() => {
    const update = () => setSnap(read(videoRef.current, containerRef.current, getRef.current));
    const first = window.setTimeout(update, 0);
    const id = window.setInterval(update, 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [videoRef, containerRef]);

  const hls = snap?.hls ?? null;
  const loading = hls?.levels[hls.loadingLevel];
  const playing = hls?.levels[hls.playingLevel];
  const rows: [string, string][] = snap
    ? [
        ["Mode", MODE_LABEL[mode]],
        ["Resolution", snap.resolution],
        ["Player size", snap.viewport],
        ...(hls
          ? ([
              ["Quality", `${playing?.label ?? "—"}${hls.auto ? " (auto)" : " (pinned)"}`],
              ["Loading", loading ? `${loading.label} · ${kbps(loading.bandwidth)}` : "—"],
              ["Codecs", playing?.codecs ?? loading?.codecs ?? "—"],
              ["Bandwidth estimate", kbps(hls.estimate)],
              ["Last segment", hls.lastSegment ? `${formatBytes(hls.lastSegment.bytes)} in ${hls.lastSegment.ms} ms` : "—"],
              ["Segments / data", `${hls.segmentsLoaded} · ${formatBytes(hls.bytesLoaded)}`],
              ["Quality switches", String(hls.switches)],
              ["Retries", String(hls.retries)],
            ] as [string, string][])
          : []),
        ["Buffer ahead", `${snap.bufferAhead.toFixed(1)} s${hls ? ` / ${hls.forwardTarget} s` : ""}`],
        ["Back buffer", `${snap.backBuffer.toFixed(1)} s`],
        ["Dropped frames", `${snap.dropped} / ${snap.frames}`],
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-label="Playback statistics"
      className="absolute left-2 top-2 z-30 w-[min(20rem,calc(100%-1rem))] rounded-lg bg-black/80 p-3 font-mono text-[11px] leading-5 text-white/90 shadow-lg backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-sans text-xs font-semibold text-white">Stats for nerds</p>
        <button
          type="button"
          onClick={onClose}
          ref={closeRef}
          aria-label="Close statistics"
          className="flex size-6 items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Icon.X className="size-3.5" />
        </button>
      </div>
      {snap ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white/55">{k}</dt>
              <dd className="truncate text-right" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-white/60">Collecting…</p>
      )}
    </div>
  );
}
