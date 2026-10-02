"use client";

import { useEffect, useRef, useState } from "react";
import { clamp, cn, formatTime } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/** Compact custom audio player (no native controls). */
export function AudioPlayer({ src, title, className }: { src: string; title?: string; className?: string }) {
  const t = useT("learning");
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const seek = (t: number) => {
    const a = ref.current;
    if (!a) return;
    a.currentTime = clamp(t, 0, duration);
  };
  const cycleRate = () => {
    const rates = [1, 1.25, 1.5, 2, 0.75];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length]!;
    setRate(next);
    if (ref.current) ref.current.playbackRate = next;
  };
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className={cn("flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3", className)}>
      <audio ref={ref} src={src} preload="metadata" muted={muted} />
      <button type="button" onClick={toggle} aria-label={playing ? t("global.player.pause") : t("global.player.play")} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:brightness-110">
        {playing ? <Icon.Pause className="size-5" /> : <Icon.Play className="ml-0.5 size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        {title && <p className="mb-1 truncate text-sm font-medium text-ink">{title}</p>}
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">{formatTime(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={t("global.player.seek")}
            className="ll-range h-1 flex-1 cursor-pointer"
            style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--surface-3) ${pct}%)` }}
          />
          <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-muted">{formatTime(duration)}</span>
        </div>
      </div>
      <button type="button" onClick={cycleRate} className="shrink-0 rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:bg-surface-2" title={t("global.player.speed")}>
        {rate}×
      </button>
      <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? t("global.player.unmute") : t("global.player.mute")} className="shrink-0 rounded-md p-1.5 text-ink-muted hover:bg-surface-2">
        {muted ? <Icon.VolumeMute className="size-4" /> : <Icon.VolumeHigh className="size-4" />}
      </button>
    </div>
  );
}
