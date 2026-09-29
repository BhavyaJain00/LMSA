"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { KeyboardIcon } from "./player-icons";

export interface ShortcutItem {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Keyboard shortcuts of the player, filtered to the features this instance offers. */
export function playerShortcuts(features: { captions: boolean; pip: boolean; theater: boolean; fullscreen: boolean }): ShortcutGroup[] {
  const playback: ShortcutItem[] = [
    { keys: ["Space", "K"], label: "Play or pause" },
    { keys: ["J"], label: "Back 10 seconds" },
    { keys: ["L"], label: "Forward 10 seconds" },
    { keys: ["←"], label: "Back 5 seconds" },
    { keys: ["→"], label: "Forward 5 seconds" },
    { keys: ["<", ","], label: "Slower playback" },
    { keys: [">", "."], label: "Faster playback" },
  ];
  const navigation: ShortcutItem[] = [
    { keys: ["0–9"], label: "Jump to 0%–90% of the video" },
    { keys: ["Home"], label: "Go to the start" },
    { keys: ["End"], label: "Go to the end" },
  ];
  const sound: ShortcutItem[] = [
    { keys: ["↑"], label: "Volume up" },
    { keys: ["↓"], label: "Volume down" },
    { keys: ["M"], label: "Mute or unmute" },
  ];
  const view: ShortcutItem[] = [];
  if (features.fullscreen) view.push({ keys: ["F"], label: "Fullscreen" });
  if (features.theater) view.push({ keys: ["T"], label: "Theater mode" });
  if (features.pip) view.push({ keys: ["P"], label: "Picture in picture" });
  if (features.captions) view.push({ keys: ["C"], label: "Captions on or off" });
  view.push({ keys: ["?"], label: "Show or hide these shortcuts" });
  view.push({ keys: ["Esc"], label: "Close menus and this panel" });
  return [
    { title: "Playback", items: playback },
    { title: "Sound", items: sound },
    { title: "Navigation", items: navigation },
    { title: "View", items: view },
  ];
}

/**
 * Accessible overlay listing the player's keyboard shortcuts. Rendered inside
 * the player so it also works in fullscreen. Focus moves into the panel,
 * Tab cycles inside it and Escape (or `?`) closes it and returns focus.
 */
export function ShortcutsOverlay({ groups, onClose }: { groups: ShortcutGroup[]; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      e.stopPropagation();
      return;
    }
    // Keep player shortcuts from acting behind the panel.
    e.stopPropagation();
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl bg-black/90 backdrop-blur text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
          <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold">
            <KeyboardIcon className="size-4 text-white/70" /> Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="flex size-8 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Icon.X className="size-4" />
          </button>
        </div>
        <div className="scrollbar-thin grid gap-x-6 gap-y-4 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">{group.title}</h3>
              <dl className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-white/85">{item.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="text-xs text-white/40">or</span>}
                          <kbd className="min-w-6 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-center font-sans text-xs text-white">{k}</kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
