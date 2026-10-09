"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useLearnPrefs } from "./learn-provider";
import { useOptionalLessonRuntime } from "./lesson-runtime";
import type { SidebarTab } from "./types";
import { useT } from "@/i18n/client";
import { FocusExitIcon, FocusIcon } from "./learn-icons";

/**
 * Two-column lesson layout (content 70% / sidebar 30% on desktop), drawn as two
 * rounded panels on the page canvas like the rest of the app. Zen mode
 * collapses the sidebar (it can be brought back as an overlay with
 * ZenPanelToggle) and narrows the reading column via the `--lesson-w`
 * variable used by every block. Theater mode collapses the sidebar only on
 * lessons with a video: the player is its only off switch, so it must not
 * hide the sidebar on lessons without one.
 */
export function LessonFrame({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) {
  const { zen, theater, zenPanel, setZenPanel } = useLearnPrefs();
  const t = useT("learning");
  const rt = useOptionalLessonRuntime();
  const theaterActive = theater && !!rt?.hasVideo;
  const collapse = zen || theaterActive || !sidebar;
  const overlay = zen && zenPanel && !!sidebar;
  return (
    <div
      className={cn(
        "flex flex-1 flex-col lg:grid lg:gap-3",
        zen ? "lg:p-3" : "lg:px-3 lg:pb-3",
        collapse ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]",
      )}
      style={{ "--lesson-w": zen ? "46rem" : "56rem" } as CSSProperties}
    >
      <div className={cn("min-w-0 flex-1 bg-panel lg:rounded-2xl lg:border lg:border-border lg:shadow-sm", zen ? "lg:min-h-[calc(100dvh-1.5rem)]" : "lg:min-h-[calc(100dvh-4.25rem)]")}>
        {children}
      </div>
      {sidebar &&
        (overlay ? (
          <div className="min-w-0 lg:fixed lg:inset-y-0 lg:end-0 lg:z-40 lg:flex lg:w-[min(26rem,40vw)] lg:flex-col lg:border-s lg:border-border lg:bg-panel lg:shadow-pop lg:[&>aside]:static lg:[&>aside]:h-auto lg:[&>aside]:min-h-0 lg:[&>aside]:flex-1 lg:[&>aside]:rounded-none lg:[&>aside]:border-0 lg:[&>aside]:shadow-none animate-fade-in">
            <div className="hidden h-14 shrink-0 items-center border-b border-border px-3 lg:flex">
              <button
                type="button"
                onClick={() => setZenPanel(false)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Icon.X className="size-4" /> {t("learn.zen.hidePanel")}
              </button>
            </div>
            {sidebar}
          </div>
        ) : (
          <div className={cn("min-w-0", (zen || theaterActive) && "lg:hidden")}>{sidebar}</div>
        ))}
    </div>
  );
}

/**
 * Zen mode only: "Toggle discussions" shows the notes / discussion sidebar
 * (an overlay on desktop, the bottom sheet on small screens) and moves focus to it.
 */
export function ZenPanelToggle({ tab, className }: { tab: Exclude<SidebarTab, "outline">; className?: string }) {
  const { zen, zenPanel, setZenPanel } = useLearnPrefs();
  const rt = useOptionalLessonRuntime();
  const t = useT("learning");
  if (!zen || !rt) return null;
  const label = t("learn.zen.toggleDiscussions");
  const onClick = () => {
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      rt.openSidebar(tab);
      return;
    }
    if (zenPanel) {
      setZenPanel(false);
      return;
    }
    rt.setTab(tab);
    setZenPanel(true);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`sidebar-tab-${tab}`) ?? document.getElementById("lesson-sidebar");
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    });
  };
  return (
    <Tooltip label={label} side="bottom" className={className}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={zenPanel}
        aria-controls="lesson-sidebar"
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
          zenPanel && "bg-accent/10 text-accent",
        )}
      >
        <Icon.MessageSquare className="size-4" />
      </button>
    </Tooltip>
  );
}

/** Header button that toggles zen (distraction-free, fullscreen) mode. */
export function ZenToggle({ className }: { className?: string }) {
  const { zen, toggleZen } = useLearnPrefs();
  const t = useT("learning");
  const label = zen ? t("learn.zen.exit") : t("learn.zen.enter");
  return (
    <Tooltip label={label} side="bottom" className={className}>
      <button
        type="button"
        onClick={toggleZen}
        aria-pressed={zen}
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
          zen && "bg-accent/10 text-accent",
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
