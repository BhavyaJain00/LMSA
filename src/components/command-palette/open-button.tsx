"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "./events";

const noopSubscribe = () => () => {};
const isMacClient = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const isMacServer = () => false;

/** Keyboard shortcut label: "⌘K" on Apple devices, "Ctrl K" elsewhere (hydration-safe). */
export function useShortcutLabel(): string {
  const mac = useSyncExternalStore(noopSubscribe, isMacClient, isMacServer);
  return mac ? "⌘K" : "Ctrl K";
}

/** Search-field style button that opens the command palette. */
export function CommandPaletteButton({ className, label = "Search or jump to…" }: { className?: string; label?: string }) {
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 pl-3 pr-2 text-sm text-ink-faint transition-colors hover:border-border-strong hover:text-ink-muted",
        className,
      )}
    >
      <Icon.Search className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <kbd className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-px font-sans text-[10px] font-medium text-ink-muted">{shortcut}</kbd>
    </button>
  );
}
