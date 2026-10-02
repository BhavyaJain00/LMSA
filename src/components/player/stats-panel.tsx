"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { formatBytes } from "@/lib/utils";
import { backBufferLength, bufferInfo, toRanges } from "./hls/buffer";
import type { HlsStats } from "./hls/engine";
import { useT } from "@/i18n/client";

export type PlaybackMode = "mse" | "native" | "progressive";

const MODE_LABEL = {
  mse: "global.player.stats.modeMse",
  native: "global.player.stats.modeNative",
  progressive: "global.player.stats.modeProgressive",
} as const satisfies Record<PlaybackMode, string>;

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
  const t = useT("learning");
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
        [t("global.player.stats.mode"), t(MODE_LABEL[mode])],
        [t("global.player.stats.resolution"), snap.resolution],
        [t("global.player.stats.playerSize"), snap.viewport],
        ...(hls
          ? ([
              [t("global.player.stats.quality"), t(hls.auto ? "global.player.stats.qualityAuto" : "global.player.stats.qualityPinned", { quality: playing?.label ?? "—" })],
              [t("global.player.stats.loading"), loading ? `${loading.label} · ${kbps(loading.bandwidth)}` : "—"],
              [t("global.player.stats.codecs"), playing?.codecs ?? loading?.codecs ?? "—"],
              [t("global.player.stats.bandwidth"), kbps(hls.estimate)],
              [
                t("global.player.stats.lastSegment"),
                hls.lastSegment ? t("global.player.stats.lastSegmentValue", { size: formatBytes(hls.lastSegment.bytes), ms: hls.lastSegment.ms }) : "—",
              ],
              [t("global.player.stats.segments"), `${hls.segmentsLoaded} · ${formatBytes(hls.bytesLoaded)}`],
              [t("global.player.stats.switches"), String(hls.switches)],
              [t("global.player.stats.retries"), String(hls.retries)],
            ] as [string, string][])
          : []),
        [t("global.player.stats.bufferAhead"), `${snap.bufferAhead.toFixed(1)} s${hls ? ` / ${hls.forwardTarget} s` : ""}`],
        [t("global.player.stats.backBuffer"), `${snap.backBuffer.toFixed(1)} s`],
        [t("global.player.stats.dropped"), `${snap.dropped} / ${snap.frames}`],
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-label={t("global.player.stats.label")}
      className="absolute left-2 top-2 z-30 w-[min(20rem,calc(100%-1rem))] rounded-lg bg-black/80 p-3 font-mono text-[11px] leading-5 text-white/90 shadow-lg backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-sans text-xs font-semibold text-white">{t("global.player.stats.title")}</p>
        <button
          type="button"
          onClick={onClose}
          ref={closeRef}
          aria-label={t("global.player.stats.close")}
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
        <p className="text-white/60">{t("global.player.stats.collecting")}</p>
      )}
    </div>
  );
}
