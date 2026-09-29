"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Share of the player that must stay visible before it docks. */
const VISIBLE_RATIO = 0.35;

/**
 * Docks a playing video into a floating mini-player when its slot scrolls
 * out of view (IntersectionObserver on the in-flow placeholder), and back
 * when the slot is visible again. The same <video> element keeps playing:
 * the caller only toggles a fixed-position class on the player container.
 *
 * Docking starts only while playing; once docked the mini-player stays
 * (even when paused) until the slot is back in view or it is closed.
 */
export function useMiniPlayer({
  enabled,
  slotRef,
  playing,
  blocked,
}: {
  enabled: boolean;
  /** The in-flow wrapper that keeps the player's place in the page. */
  slotRef: RefObject<HTMLElement | null>;
  playing: boolean;
  /** Fullscreen, picture-in-picture, an overlay (quiz) or an error: never dock. */
  blocked: boolean;
}) {
  const [engaged, setEngaged] = useState(false);
  const playingRef = useRef(playing);
  const outOfView = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!enabled || !slot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const hidden = !entry.isIntersecting || entry.intersectionRatio < VISIBLE_RATIO;
        const wasHidden = outOfView.current;
        outOfView.current = hidden;
        if (!hidden) setEngaged(false);
        else if (!wasHidden && playingRef.current) setEngaged(true);
      },
      { threshold: [0, VISIBLE_RATIO, 0.6] },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [enabled, slotRef]);

  // Starting playback while the slot is off-screen (e.g. keyboard) docks right away.
  const onPlay = useCallback(() => {
    if (enabled && outOfView.current) setEngaged(true);
  }, [enabled]);

  /** Close the mini-player (the caller pauses the video). */
  const close = useCallback(() => setEngaged(false), []);

  /** Scroll the placeholder back into view; the observer then undocks. */
  const returnToSlot = useCallback(
    (smooth = true) => {
      slotRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    },
    [slotRef],
  );

  return { docked: enabled && engaged && !blocked, onPlay, close, returnToSlot };
}
