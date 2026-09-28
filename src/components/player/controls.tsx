"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn, formatTime } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import type { PlayerActions, PlayerState } from "./use-video-player";
import { SeekBar, chapterAt, type SeekChapter, type SeekMarker } from "./seek-bar";

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function ControlButton({ label, onClick, children, active, className }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 [&>svg]:size-5",
        active && "text-[var(--player-accent)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Volume --------------------------------- */

export function VolumeControl({ state, actions }: { state: PlayerState; actions: PlayerActions }) {
  const level = state.muted ? 0 : state.volume;
  const VolIcon = level === 0 ? Icon.VolumeMute : level < 0.5 ? Icon.VolumeLow : Icon.VolumeHigh;
  return (
    <div
      className="group/vol flex items-center"
      onWheel={(e) => {
        e.preventDefault();
        actions.setVolume(level + (e.deltaY < 0 ? 0.05 : -0.05));
      }}
    >
      <ControlButton label={state.muted ? "Unmute (m)" : "Mute (m)"} onClick={actions.toggleMute}>
        <VolIcon />
      </ControlButton>
      <div className="flex w-0 items-center overflow-hidden transition-[width] duration-200 group-hover/vol:w-20 group-focus-within/vol:w-20">
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={level}
          onChange={(e) => actions.setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="ll-range mx-1 h-1 w-16 cursor-pointer"
          style={{ background: `linear-gradient(to right, #fff ${level * 100}%, rgba(255,255,255,0.3) ${level * 100}%)` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ Settings menu ------------------------------ */

type MenuPage = "root" | "speed" | "captions" | "chapters";

function MenuRow({ label, value, onClick, icon }: { label: string; value?: ReactNode; onClick: () => void; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-sm text-white hover:bg-white/10">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {value !== undefined && (
        <span className="flex items-center gap-1 text-white/70">
          {value}
          <Icon.ChevronRight className="size-4" />
        </span>
      )}
    </button>
  );
}

function MenuOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-white/10", selected ? "text-white" : "text-white/80")}
    >
      <span className="flex size-4 items-center justify-center">{selected && <Icon.Check className="size-4" />}</span>
      {label}
    </button>
  );
}

function MenuBack({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-3 pb-2 pt-1 text-sm font-medium text-white">
      <Icon.ChevronLeft className="size-4" /> {title}
    </button>
  );
}

export function SettingsMenu({
  state,
  actions,
  chapters,
  onOpenChange,
  loop,
  onToggleLoop,
}: {
  state: PlayerState;
  actions: PlayerActions;
  chapters?: SeekChapter[];
  onOpenChange?: (open: boolean) => void;
  loop: boolean;
  onToggleLoop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>("root");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  const currentChapter = chapterAt(chapters, state.currentTime);
  const goRoot = () => setPage("root");

  return (
    <div ref={ref} className="relative">
      <ControlButton
        label="Settings"
        active={open}
        onClick={() => {
          setOpen((v) => !v);
          setPage("root");
        }}
      >
        <Icon.Settings className={cn("transition-transform duration-300", open && "rotate-45")} />
      </ControlButton>
      {open && (
        <div role="menu" className="absolute bottom-full right-0 z-30 mb-2 w-60 rounded-lg bg-black/90 p-1.5 text-white shadow-lg backdrop-blur animate-scale-in">
          {page === "root" && (
            <>
              <MenuRow label="Playback speed" value={state.rate === 1 ? "Normal" : `${state.rate}×`} onClick={() => setPage("speed")} icon={<Icon.Speed className="size-4 text-white/70" />} />
              {state.hasCaptions && <MenuRow label="Captions" value={state.captionsOn ? "On" : "Off"} onClick={() => setPage("captions")} icon={<Icon.Captions className="size-4 text-white/70" />} />}
              {chapters && chapters.length > 0 && (
                <MenuRow
                  label="Chapters"
                  value={<span className="max-w-20 truncate">{currentChapter?.title ?? ""}</span>}
                  onClick={() => setPage("chapters")}
                  icon={<Icon.ListChecks className="size-4 text-white/70" />}
                />
              )}
              <MenuRow label="Loop" value={loop ? "On" : "Off"} onClick={onToggleLoop} icon={<Icon.Replay className="size-4 text-white/70" />} />
            </>
          )}
          {page === "speed" && (
            <>
              <MenuBack title="Playback speed" onClick={goRoot} />
              {PLAYBACK_RATES.map((r) => (
                <MenuOption
                  key={r}
                  label={r === 1 ? "Normal" : `${r}×`}
                  selected={state.rate === r}
                  onClick={() => {
                    actions.setRate(r);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}
          {page === "captions" && (
            <>
              <MenuBack title="Captions" onClick={goRoot} />
              <MenuOption label="Off" selected={!state.captionsOn} onClick={() => state.captionsOn && actions.toggleCaptions()} />
              <MenuOption label="On" selected={state.captionsOn} onClick={() => !state.captionsOn && actions.toggleCaptions()} />
            </>
          )}
          {page === "chapters" && chapters && (
            <>
              <MenuBack title="Chapters" onClick={goRoot} />
              <div className="max-h-64 overflow-y-auto scrollbar-thin">
                {chapters.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      actions.seek(c.time);
                      setOpen(false);
                    }}
                    className={cn("flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm hover:bg-white/10", currentChapter === c ? "text-[var(--player-accent)]" : "text-white/85")}
                  >
                    <span className="w-12 shrink-0 font-mono text-xs text-white/60">{formatTime(c.time)}</span>
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Control bar ------------------------------- */

export function ControlBar({
  state,
  actions,
  chapters,
  markers,
  maxSeekable,
  visible,
  onMenuOpenChange,
  onMarkerClick,
  theater,
  onToggleTheater,
  loop,
  onToggleLoop,
  onScrubStart,
  onScrubEnd,
}: {
  state: PlayerState;
  actions: PlayerActions;
  chapters?: SeekChapter[];
  markers?: SeekMarker[];
  maxSeekable?: number;
  visible: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  onMarkerClick?: (marker: SeekMarker) => void;
  theater?: boolean;
  onToggleTheater?: () => void;
  loop: boolean;
  onToggleLoop: () => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const [showRemaining, setShowRemaining] = useState(false);
  const currentChapter = chapterAt(chapters, state.currentTime);
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-1 pt-10 transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <SeekBar
        currentTime={state.currentTime}
        duration={state.duration}
        buffered={state.buffered}
        chapters={chapters}
        markers={markers}
        maxSeekable={maxSeekable}
        onSeek={actions.seek}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        onMarkerClick={onMarkerClick}
      />
      <div className="flex items-center gap-0.5">
        <ControlButton label={state.playing ? "Pause (k)" : "Play (k)"} onClick={actions.toggle}>
          {state.ended ? <Icon.Replay /> : state.playing ? <Icon.Pause /> : <Icon.Play />}
        </ControlButton>
        <ControlButton label="Rewind 10 seconds (j)" onClick={() => actions.skip(-10)} className="hidden sm:flex">
          <Icon.Rewind10 />
        </ControlButton>
        <ControlButton label="Forward 10 seconds (l)" onClick={() => actions.skip(10)} className="hidden sm:flex">
          <Icon.Forward10 />
        </ControlButton>
        <VolumeControl state={state} actions={actions} />
        <button
          type="button"
          onClick={() => setShowRemaining((v) => !v)}
          className="ml-1 rounded px-1.5 font-mono text-xs tabular-nums text-white/90 hover:bg-white/10"
          title="Toggle remaining time"
        >
          {showRemaining ? `-${formatTime(Math.max(0, state.duration - state.currentTime))}` : formatTime(state.currentTime)}
          <span className="text-white/60"> / {formatTime(state.duration)}</span>
        </button>
        {currentChapter && (
          <span className="ml-2 hidden min-w-0 truncate text-xs text-white/80 md:inline">
            <span className="text-white/50">•</span> {currentChapter.title}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {state.hasCaptions && (
            <ControlButton label={state.captionsOn ? "Turn off captions (c)" : "Turn on captions (c)"} active={state.captionsOn} onClick={actions.toggleCaptions}>
              <Icon.Captions />
            </ControlButton>
          )}
          <SettingsMenu state={state} actions={actions} chapters={chapters} onOpenChange={onMenuOpenChange} loop={loop} onToggleLoop={onToggleLoop} />
          {pipSupported && (
            <ControlButton label="Picture in picture (p)" active={state.pip} onClick={actions.togglePip} className="hidden sm:flex">
              <Icon.PictureInPicture />
            </ControlButton>
          )}
          {onToggleTheater && (
            <ControlButton label="Theater mode (t)" active={theater} onClick={onToggleTheater} className="hidden lg:flex">
              <Icon.Theater />
            </ControlButton>
          )}
          <ControlButton label={state.fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"} onClick={actions.toggleFullscreen}>
            {state.fullscreen ? <Icon.ExitFullscreen /> : <Icon.Fullscreen />}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}
