"use client";

import { Icon } from "@/components/ui/icons";
import { openCommandPalette } from "@/components/command-palette/events";
import { useShortcutLabel } from "@/components/command-palette/open-button";

/** "Search" row that opens the command palette. */
export function SearchRow({ className }: { className: string }) {
  const shortcut = useShortcutLabel();
  return (
    <button type="button" onClick={openCommandPalette} className={className}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
        <Icon.Search className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-left text-sm text-ink">Search</span>
      <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-px font-sans text-[10px] text-ink-muted sm:inline">{shortcut}</kbd>
      <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />
    </button>
  );
}
