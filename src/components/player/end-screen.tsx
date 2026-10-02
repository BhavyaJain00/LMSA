"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { NextTrackIcon } from "./player-icons";
import { useT } from "@/i18n/client";

export const AUTOPLAY_NEXT_SECONDS = 5;

const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Shown when the video ends. With `autoplay` and a next action, a 5-second
 * countdown ("Next lesson in 5…") runs with a Cancel button; the animated
 * ring is replaced by a plain number when the viewer prefers reduced motion.
 */
export function EndScreen({
  title,
  compact,
  onReplay,
  onNext,
  nextLabel,
  nextTitle,
  countdownLabel,
  autoplay,
  reducedMotion,
}: {
  title?: string;
  compact?: boolean;
  onReplay: () => void;
  onNext?: () => void;
  nextLabel: string;
  nextTitle?: string;
  /** "<label> in 5…" */
  countdownLabel?: string;
  autoplay: boolean;
  reducedMotion: boolean;
}) {
  const t = useT("learning");
  const [seconds, setSeconds] = useState(AUTOPLAY_NEXT_SECONDS);
  const [cancelled, setCancelled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);
  const counting = autoplay && !!onNext && !cancelled;

  useEffect(() => {
    if (!counting) return;
    let remaining = AUTOPLAY_NEXT_SECONDS;
    let fallback: number | null = null;
    const id = window.setInterval(() => {
      remaining -= 1;
      setSeconds(Math.max(0, remaining));
      if (remaining > 0) return;
      window.clearInterval(id);
      onNextRef.current?.();
      // If navigation was refused (e.g. the next lesson is still locked), fall back to the regular end screen.
      fallback = window.setTimeout(() => setCancelled(true), 1500);
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (fallback !== null) window.clearTimeout(fallback);
    };
  }, [counting]);

  // Keyboard users who were in the player land on the primary action.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const player = root.closest(".ll-player");
    if (player && player.contains(document.activeElement)) root.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [counting]);

  const goNext = () => onNext?.();

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/75 px-6 text-center animate-fade-in">
      {counting ? (
        <>
          <div className="flex flex-col items-center gap-3" aria-live="polite">
            <span className="sr-only">
              {nextTitle ? `${t("global.player.end.upNextSr", { title: nextTitle })} ` : ""}
              {t("global.player.end.autoplaySr", { seconds: AUTOPLAY_NEXT_SECONDS })}
            </span>
            {!compact && (
              <span className="relative flex size-16 items-center justify-center" aria-hidden="true">
                {!reducedMotion && (
                  <svg viewBox="0 0 60 60" className="absolute inset-0 size-full -rotate-90">
                    <circle cx="30" cy="30" r={RING_RADIUS} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="4" />
                    <circle
                      cx="30"
                      cy="30"
                      r={RING_RADIUS}
                      fill="none"
                      stroke="var(--player-accent)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={RING_LENGTH}
                      strokeDashoffset={(RING_LENGTH * seconds) / AUTOPLAY_NEXT_SECONDS}
                      className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                    />
                  </svg>
                )}
                <span className={reducedMotion ? "text-3xl font-semibold tabular-nums" : "text-xl font-semibold tabular-nums"}>{seconds}</span>
              </span>
            )}
            <p className="text-sm font-medium text-white" aria-hidden="true">
              {t("global.player.end.countdown", { label: countdownLabel ?? t("global.player.nextLesson"), seconds })}
            </p>
            {nextTitle && !compact && <p className="max-w-sm truncate text-xs text-white/70">{t("global.player.end.upNext", { title: nextTitle })}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              data-autofocus
              onClick={() => setCancelled(true)}
              className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {t("global.player.end.cancel")}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-2 rounded-lg bg-(--player-accent) px-4 py-2 text-sm font-medium hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <NextTrackIcon className="size-4" /> {t("global.player.end.playNow")}
            </button>
          </div>
        </>
      ) : (
        <>
          {!compact && <p className="text-sm text-white/80">{title ? t("global.player.end.finished", { title }) : t("global.player.end.complete")}</p>}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              data-autofocus={onNext ? undefined : true}
              onClick={onReplay}
              className="flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Icon.Replay className="size-4" /> {t("global.player.end.replay")}
            </button>
            {onNext && (
              <button
                type="button"
                data-autofocus
                onClick={goNext}
                className="flex items-center gap-2 rounded-lg bg-(--player-accent) px-4 py-2 text-sm font-medium hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {nextLabel} <Icon.ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
