"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/dropdown";
import { useLearnPrefs } from "./learn-provider";
import { FocusExitIcon, FocusIcon } from "./learn-icons";

/**
 * Two-column lesson layout (content 70% / sidebar 30% on desktop). Zen and
 * theater modes collapse the sidebar; zen also narrows the reading column via
 * the `--lesson-w` variable used by every block.
 */
export function LessonFrame({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) {
  const { zen, theater } = useLearnPrefs();
  const collapse = zen || theater || !sidebar;
  return (
    <div
      className={cn("flex-1 lg:grid", collapse ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]")}
      style={{ "--lesson-w": zen ? "46rem" : "56rem" } as CSSProperties}
    >
      <div className="min-w-0">{children}</div>
      {sidebar && <div className={cn("min-w-0", (zen || theater) && "lg:hidden")}>{sidebar}</div>}
    </div>
  );
}

/** Header button that toggles zen (distraction-free, fullscreen) mode. */
export function ZenToggle({ className }: { className?: string }) {
  const { zen, toggleZen } = useLearnPrefs();
  const label = zen ? "Exit zen mode" : "Zen mode";
  return (
    <Tooltip label={label} side="bottom" className={className}>
      <button
        type="button"
        onClick={toggleZen}
        aria-pressed={zen}
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg border border-border-strong text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
          zen && "border-accent bg-accent/10 text-accent",
        )}
      >
        {zen ? <FocusExitIcon className="size-4" /> : <FocusIcon className="size-4" />}
      </button>
    </Tooltip>
  );
}

/** Makes a subtitle visible only in zen mode (the regular header is hidden there). */
export function ZenOnly({ children }: { children: ReactNode }) {
  const { zen } = useLearnPrefs();
  if (!zen) return null;
  return <>{children}</>;
}

/** Hides its children in zen mode. */
export function HideInZen({ children }: { children: ReactNode }) {
  const { zen } = useLearnPrefs();
  if (zen) return null;
  return <>{children}</>;
}
