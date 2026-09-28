"use client";

import { useEffect, useRef, useState } from "react";
import type { ViolationType } from "@/lib/types";

/**
 * Seconds left until `deadline` (epoch ms), ticking twice a second. Uses the
 * wall clock rather than counting ticks, so throttled background tabs stay
 * accurate. Calls `onExpire` once when the deadline passes.
 * Returns null when there is no deadline (or before the first tick).
 */
export function useCountdown(deadline: number | null, onExpire: () => void): number | null {
  const [now, setNow] = useState<number | null>(null);
  const expireRef = useRef(onExpire);
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    expireRef.current = onExpire;
  });

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline && firedFor.current !== deadline) {
        firedFor.current = deadline;
        expireRef.current();
      }
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [deadline]);

  if (deadline === null || now === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Runs `callback` every `ms` milliseconds while `enabled` (first run after one interval).
 */
export function useInterval(callback: () => void, ms: number, enabled = true): void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

/**
 * Browser-based proctoring. While `active`, reports:
 *  - tab_switch: the page became hidden (tab switch, minimise)
 *  - focus_loss: the window lost focus for more than a second while visible
 *  - fullscreen_exit: fullscreen was entered and then left
 *  - copy_paste: copy, cut or paste (the action is blocked)
 * Events closer than 1.5s apart are merged (a tab switch also blurs the window).
 */
export function useProctoring(active: boolean, onEvent: (type: ViolationType) => void): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });

  useEffect(() => {
    if (!active) return;
    let last = 0;
    let blurTimer: number | undefined;
    let wasFullscreen = !!document.fullscreenElement;

    const emit = (type: ViolationType) => {
      const t = Date.now();
      if (t - last < 1500) return;
      last = t;
      ref.current(type);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") emit("tab_switch");
    };
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible" && !document.hasFocus()) emit("focus_loss");
      }, 1000);
    };
    const onFocus = () => window.clearTimeout(blurTimer);
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        wasFullscreen = true;
      } else if (wasFullscreen) {
        wasFullscreen = false;
        emit("fullscreen_exit");
      }
    };
    const onClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      emit("copy_paste");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
    };
  }, [active]);
}

/** Tracks whether `document.fullscreenElement` is set. */
export function useIsFullscreen(): boolean {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  return fs;
}
