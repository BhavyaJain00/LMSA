"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FocusExitIcon } from "./learn-icons";

/**
 * Course-level learning preferences that persist while the learner moves
 * between lessons (the provider lives in the course "learn" layout):
 *  - zen mode: hides the top bar and sidebar for distraction-free reading and
 *    asks the browser for fullscreen (Esc leaves it);
 *  - theater mode: hides the sidebar and lets videos use the full width
 *    (only on lessons that have a video; see LessonFrame);
 *  - zen panel: in zen mode, the notes/discussion sidebar can be shown as an
 *    overlay ("Toggle discussions").
 */
interface LearnPrefs {
  zen: boolean;
  theater: boolean;
  /** Zen mode only: the sidebar (notes / discussion) is shown as an overlay. */
  zenPanel: boolean;
  setZenPanel: (value: boolean) => void;
  setZen: (value: boolean) => void;
  toggleZen: () => void;
  setTheater: (value: boolean) => void;
  toggleTheater: () => void;
}

const LearnPrefsContext = createContext<LearnPrefs | null>(null);

const FALLBACK: LearnPrefs = {
  zen: false,
  theater: false,
  zenPanel: false,
  setZenPanel: () => undefined,
  setZen: () => undefined,
  toggleZen: () => undefined,
  setTheater: () => undefined,
  toggleTheater: () => undefined,
};

export function useLearnPrefs(): LearnPrefs {
  return useContext(LearnPrefsContext) ?? FALLBACK;
}

/** Open layers that handle Escape themselves; zen mode must not also exit on that key press. */
const OPEN_LAYER_SELECTOR = "dialog[open], [role='menu'], [role='toolbar'][data-selection-toolbar], [data-lesson-sheet-open]";

export function LearnProvider({ children }: { children: ReactNode }) {
  const [zen, setZenState] = useState(false);
  const [theater, setTheater] = useState(false);
  const [zenPanel, setZenPanel] = useState(false);
  /** Whether zen mode put the document into fullscreen (so we know to leave it). */
  const zenFullscreen = useRef(false);

  const setZen = useCallback((value: boolean) => {
    setZenState(value);
    if (!value) setZenPanel(false);
    if (typeof document === "undefined") return;
    if (value) {
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) {
        root
          .requestFullscreen()
          .then(() => {
            zenFullscreen.current = true;
          })
          .catch(() => {
            zenFullscreen.current = false;
          });
      }
    } else if (zenFullscreen.current) {
      zenFullscreen.current = false;
      if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const toggleZen = useCallback(() => setZen(!zen), [setZen, zen]);
  const toggleTheater = useCallback(() => setTheater((v) => !v), []);

  // Leaving browser fullscreen (Esc) also leaves zen mode.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && zenFullscreen.current) {
        zenFullscreen.current = false;
        setZenState(false);
        setZenPanel(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Esc leaves zen mode when the browser did not go fullscreen. Menus, the
  // selection toolbar, the mobile sheet and dialogs close on Escape without
  // preventDefault, and may already be unmounted by the time the event
  // bubbles to window, so whether one was open is recorded in the capture phase.
  useEffect(() => {
    if (!zen) return;
    let layerOpen = false;
    const onCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") layerOpen = !!document.querySelector(OPEN_LAYER_SELECTOR);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const blocked = layerOpen || !!document.querySelector(OPEN_LAYER_SELECTOR);
      layerOpen = false;
      if (blocked) return;
      if (zenPanel) {
        setZenPanel(false);
        return;
      }
      setZen(false);
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [zen, zenPanel, setZen]);

  const value = useMemo<LearnPrefs>(
    () => ({ zen, theater, zenPanel, setZenPanel, setZen, toggleZen, setTheater, toggleTheater }),
    [zen, theater, zenPanel, setZen, toggleZen, toggleTheater],
  );

  return (
    <LearnPrefsContext.Provider value={value}>
      {children}
      {zen && (
        <button
          type="button"
          onClick={() => setZen(false)}
          className="fixed right-3 top-3 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/90 px-3 py-1.5 text-xs font-medium text-ink-muted shadow-card backdrop-blur transition-colors hover:text-ink animate-fade-in"
        >
          <FocusExitIcon className="size-4" />
          Exit zen mode
          <kbd className="hidden rounded border border-border px-1 text-[10px] text-ink-faint sm:inline">Esc</kbd>
        </button>
      )}
    </LearnPrefsContext.Provider>
  );
}
