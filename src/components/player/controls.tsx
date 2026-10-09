"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn, formatTime } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { AUTO_QUALITY, type QualityOption } from "@/lib/media/sources";
import type { PlayerActions, PlayerState } from "./use-video-player";
import { SeekBar, chapterAt, type SeekChapter, type SeekMarker } from "./seek-bar";
import { KeyboardIcon, QualityIcon } from "./player-icons";
import { PLAYBACK_RATES } from "@/lib/media/playback";
import { useT } from "@/i18n/client";

/** Shared with the server, which bounds heartbeats by the fastest rate. */
export { PLAYBACK_RATES };

// Picture-in-picture support is a browser-only fact: the server (and the hydration pass) must render
// the same markup, so the button only appears once the client store reports support.
const subscribeNever = () => () => undefined;
const clientPipSupport = (): boolean => "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
const serverPipSupport = (): boolean => false;

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
        active && "text-(--player-accent)",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Volume --------------------------------- */

export function VolumeControl({ state, actions }: { state: PlayerState; actions: PlayerActions }) {
  const t = useT("learning");
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
      <ControlButton label={state.muted ? t("global.player.unmute") : t("global.player.mute")} onClick={actions.toggleMute}>
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
          aria-label={t("global.player.volume")}
          className="ll-range mx-1 h-1 w-16 cursor-pointer"
          style={{ background: `linear-gradient(to right, #fff ${level * 100}%, rgba(255,255,255,0.3) ${level * 100}%)` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ Settings menu ------------------------------ */

type MenuPage = "root" | "speed" | "captions" | "chapters" | "quality";

function MenuRow({ label, value, onClick, icon }: { label: string; value?: ReactNode; onClick: () => void; icon?: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-start text-sm text-white hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {value !== undefined && (
        <span className="flex min-w-0 items-center gap-1 text-white/70">
          {value}
          <Icon.ChevronRight className="size-4 shrink-0" />
        </span>
      )}
    </button>
  );
}

function MenuOption({ label, hint, selected, onClick }: { label: string; hint?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-start text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none", selected ? "text-white" : "text-white/80")}
    >
      <span className="flex size-4 items-center justify-center">{selected && <Icon.Check className="size-4" />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-white/50">{hint}</span>}
    </button>
  );
}

function MenuBack({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-3 pb-2 pt-1 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
      <Icon.ChevronLeft className="size-4" /> {title}
    </button>
  );
}

export interface QualityMenuProps {
  options: QualityOption[];
  /** "auto" or an option id. */
  selected: string;
  /** The option currently playing (resolved from Auto). */
  playingId: string;
  onSelect: (id: string) => void;
}

export function SettingsMenu({
  state,
  actions,
  chapters,
  onOpenChange,
  loop,
  onToggleLoop,
  quality,
  onShowShortcuts,
  onShowStats,
}: {
  state: PlayerState;
  actions: PlayerActions;
  chapters?: SeekChapter[];
  onOpenChange?: (open: boolean) => void;
  loop: boolean;
  onToggleLoop: () => void;
  quality?: QualityMenuProps;
  onShowShortcuts?: () => void;
  onShowStats?: () => void;
}) {
  const t = useT("learning");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>("root");
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
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
  const hasQuality = !!quality && quality.options.length > 1;
  const playingOption = quality?.options.find((o) => o.id === quality.playingId);
  const qualityValue = !quality
    ? ""
    : quality.selected === AUTO_QUALITY
      ? playingOption
        ? t("global.player.qualityAutoPlaying", { quality: playingOption.label })
        : t("global.player.qualityAuto")
      : (playingOption?.label ?? "");
  const speedLabel = (rate: number) => (rate === 1 ? t("global.player.speedNormal") : `${rate}×`);

  return (
    <div ref={ref} className="relative">
      <ControlButton
        label={t("global.player.settings")}
        active={open}
        onClick={() => {
          // Fit the menu inside the player (small embeds, docked mini-player).
          const player = ref.current?.closest<HTMLElement>(".ll-player");
          setMaxHeight(player ? Math.max(120, player.clientHeight - 64) : null);
          setOpen((v) => !v);
          setPage("root");
        }}
      >
        <Icon.Settings className={cn("transition-transform duration-300", open && "rotate-45")} />
      </ControlButton>
      {open && (
        <div
          role="menu"
          aria-label={t("global.player.settingsMenu")}
          style={maxHeight ? { maxHeight } : undefined}
          className="absolute bottom-full right-0 z-30 mb-2 w-64 max-w-[calc(100cqw-1.5rem)] overflow-y-auto rounded-lg bg-black/90 p-1.5 text-white shadow-lg backdrop-blur scrollbar-thin animate-scale-in"
        >
          {page === "root" && (
            <>
              <MenuRow label={t("global.player.speed")} value={speedLabel(state.rate)} onClick={() => setPage("speed")} icon={<Icon.Speed className="size-4 text-white/70" />} />
              {hasQuality && (
                <MenuRow
                  label={t("global.player.quality")}
                  value={<span className="max-w-24 truncate">{qualityValue}</span>}
                  onClick={() => setPage("quality")}
                  icon={<QualityIcon className="size-4 text-white/70" />}
                />
              )}
              {state.hasCaptions && <MenuRow label={t("global.player.captions")} value={state.captionsOn ? t("global.player.on") : t("global.player.off")} onClick={() => setPage("captions")} icon={<Icon.Captions className="size-4 text-white/70" />} />}
              {chapters && chapters.length > 0 && (
                <MenuRow
                  label={t("global.player.chapters")}
                  value={<span className="max-w-20 truncate">{currentChapter?.title ?? ""}</span>}
                  onClick={() => setPage("chapters")}
                  icon={<Icon.ListChecks className="size-4 text-white/70" />}
                />
              )}
              <MenuRow label={t("global.player.loop")} value={loop ? t("global.player.on") : t("global.player.off")} onClick={onToggleLoop} icon={<Icon.Replay className="size-4 text-white/70" />} />
              {onShowStats && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onShowStats();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm text-white hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                >
                  <Icon.BarChart className="size-4 text-white/70" /> {t("global.player.statsForNerds")}
                </button>
              )}
              {onShowShortcuts && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onShowShortcuts();
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-start text-sm text-white hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2">
                    <KeyboardIcon className="size-4 text-white/70" /> {t("global.player.keyboardShortcuts")}
                  </span>
                  <kbd className="rounded border border-white/20 px-1.5 font-sans text-xs text-white/70">?</kbd>
                </button>
              )}
            </>
          )}
          {page === "speed" && (
            <>
              <MenuBack title={t("global.player.speed")} onClick={goRoot} />
              {PLAYBACK_RATES.map((r) => (
                <MenuOption
                  key={r}
                  label={speedLabel(r)}
                  selected={state.rate === r}
                  onClick={() => {
                    actions.setRate(r);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}
          {page === "quality" && quality && (
            <>
              <MenuBack title={t("global.player.quality")} onClick={goRoot} />
              <MenuOption
                label={t("global.player.qualityAuto")}
                hint={quality.selected === AUTO_QUALITY && playingOption ? playingOption.label : undefined}
                selected={quality.selected === AUTO_QUALITY}
                onClick={() => {
                  quality.onSelect(AUTO_QUALITY);
                  setOpen(false);
                }}
              />
              {quality.options.map((o) => (
                <MenuOption
                  key={o.id}
                  label={o.label}
                  hint={o.height && !o.label.includes(String(o.height)) ? `${o.height}p` : undefined}
                  selected={quality.selected === o.id}
                  onClick={() => {
                    quality.onSelect(o.id);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}
          {page === "captions" && (
            <>
              <MenuBack title={t("global.player.captions")} onClick={goRoot} />
              <MenuOption label={t("global.player.off")} selected={!state.captionsOn} onClick={() => state.captionsOn && actions.toggleCaptions()} />
              <MenuOption label={t("global.player.on")} selected={state.captionsOn} onClick={() => !state.captionsOn && actions.toggleCaptions()} />
            </>
          )}
          {page === "chapters" && chapters && (
            <>
              <MenuBack title={t("global.player.chapters")} onClick={goRoot} />
              <div className="max-h-64 overflow-y-auto scrollbar-thin">
                {chapters.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      actions.seek(c.time);
                      setOpen(false);
                    }}
                    className={cn("flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-start text-sm hover:bg-white/10", currentChapter === c ? "text-(--player-accent)" : "text-white/85")}
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
  compact,
  allowPip = true,
  quality,
  onShowShortcuts,
  onShowStats,
  onHoverTime,
  preview,
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
  /** Docked mini-player: only the essentials. */
  compact?: boolean;
  /** Picture-in-picture is hidden while a watermark is shown (it would bypass the overlay). */
  allowPip?: boolean;
  quality?: QualityMenuProps;
  onShowShortcuts?: () => void;
  onShowStats?: () => void;
  onHoverTime?: (time: number | null) => void;
  preview?: ReactNode;
}) {
  const t = useT("learning");
  const [showRemaining, setShowRemaining] = useState(false);
  const currentChapter = chapterAt(chapters, state.currentTime);
  const pipSupported = useSyncExternalStore(subscribeNever, clientPipSupport, serverPipSupport) && allowPip;

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-black/85 via-black/45 to-transparent transition-opacity duration-200",
        compact ? "px-2 pb-0.5 pt-6" : "px-3 pb-1 pt-10",
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
        onHoverTime={onHoverTime}
        preview={compact ? undefined : preview}
      />
      <div className="flex items-center gap-0.5">
        <ControlButton label={state.playing ? t("global.player.pauseKey") : t("global.player.playKey")} onClick={actions.toggle}>
          {state.ended ? <Icon.Replay /> : state.playing ? <Icon.Pause /> : <Icon.Play />}
        </ControlButton>
        {!compact && (
          <>
            <ControlButton label={t("global.player.rewind")} onClick={() => actions.skip(-10)} className="hidden sm:flex">
              <Icon.Rewind10 />
            </ControlButton>
            <ControlButton label={t("global.player.forward")} onClick={() => actions.skip(10)} className="hidden sm:flex">
              <Icon.Forward10 />
            </ControlButton>
            <VolumeControl state={state} actions={actions} />
          </>
        )}
        <button
          type="button"
          onClick={() => setShowRemaining((v) => !v)}
          className="ml-1 rounded px-1.5 font-mono text-xs tabular-nums text-white/90 hover:bg-white/10"
          title={t("global.player.toggleRemaining")}
        >
          {showRemaining ? `-${formatTime(Math.max(0, state.duration - state.currentTime))}` : formatTime(state.currentTime)}
          <span className="text-white/60"> / {formatTime(state.duration)}</span>
        </button>
        {currentChapter && !compact && (
          <span className="ml-2 hidden min-w-0 truncate text-xs text-white/80 md:inline">
            <span className="text-white/50">•</span> {currentChapter.title}
          </span>
        )}
        {!compact && (
          <div className="ml-auto flex items-center gap-0.5">
            {state.hasCaptions && (
              <ControlButton label={state.captionsOn ? t("global.player.captionsOff") : t("global.player.captionsOn")} active={state.captionsOn} onClick={actions.toggleCaptions}>
                <Icon.Captions />
              </ControlButton>
            )}
            <SettingsMenu
              state={state}
              actions={actions}
              chapters={chapters}
              onOpenChange={onMenuOpenChange}
              loop={loop}
              onToggleLoop={onToggleLoop}
              quality={quality}
              onShowShortcuts={onShowShortcuts}
              onShowStats={onShowStats}
            />
            {pipSupported && (
              <ControlButton label={t("global.player.pip")} active={state.pip} onClick={actions.togglePip} className="hidden sm:flex">
                <Icon.PictureInPicture />
              </ControlButton>
            )}
            {onToggleTheater && (
              <ControlButton label={t("global.player.theater")} active={theater} onClick={onToggleTheater} className="hidden lg:flex">
                <Icon.Theater />
              </ControlButton>
            )}
            <ControlButton label={state.fullscreen ? t("global.player.exitFullscreen") : t("global.player.fullscreen")} onClick={actions.toggleFullscreen}>
              {state.fullscreen ? <Icon.ExitFullscreen /> : <Icon.Fullscreen />}
            </ControlButton>
          </div>
        )}
      </div>
    </div>
  );
}
