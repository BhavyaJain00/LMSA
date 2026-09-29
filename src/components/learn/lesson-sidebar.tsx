"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { CourseOutlineNav } from "./course-outline-nav";
import { useOptionalLessonRuntime } from "./lesson-runtime";
import type { CourseProgressInfo, OutlineChapterItem, SidebarTab } from "./types";

const DESKTOP_QUERY = "(min-width: 1024px)";
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

function subscribeDesktop(callback: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

export interface LessonSidebarProps {
  courseTitle: string;
  outline: OutlineChapterItem[];
  currentLessonId: string | null;
  /** Course progress for enrolled learners (null hides the progress header). */
  progress: CourseProgressInfo | null;
  tracking: boolean;
  showPreview: boolean;
  notesPanel?: ReactNode;
  noteCount?: number;
  discussionPanel?: ReactNode;
  topicCount?: number;
}

/**
 * Right-hand sidebar of the lesson player: outline, notes and discussion tabs.
 * On desktop it is a sticky column; below 1024px it becomes a bottom sheet
 * opened from the floating "Chapters" button.
 */
export function LessonSidebar({
  courseTitle,
  outline,
  currentLessonId,
  progress,
  tracking,
  showPreview,
  notesPanel,
  noteCount,
  discussionPanel,
  topicCount,
}: LessonSidebarProps) {
  const rt = useOptionalLessonRuntime();
  const [localTab, setLocalTab] = useState<SidebarTab>("outline");
  const [localOpen, setLocalOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const rawTab = rt?.tab ?? localTab;
  const setTab = rt?.setTab ?? setLocalTab;
  const open = rt?.mobileSidebarOpen ?? localOpen;
  const setOpen = rt?.setMobileSidebarOpen ?? setLocalOpen;

  const tabs: { value: SidebarTab; label: string; count?: number; icon: ReactNode }[] = [
    { value: "outline", label: "Outline", icon: <Icon.Layers className="size-4" /> },
  ];
  if (notesPanel) tabs.push({ value: "notes", label: "Notes", count: noteCount, icon: <Icon.Note className="size-4" /> });
  if (discussionPanel) tabs.push({ value: "discussion", label: "Discussion", count: topicCount, icon: <Icon.MessageSquare className="size-4" /> });
  const tab: SidebarTab = tabs.some((t) => t.value === rawTab) ? rawTab : "outline";

  const sheetMode = !isDesktop;
  const hiddenSheet = sheetMode && !open;
  const modalSheet = sheetMode && open;

  // Mobile sheet is a modal dialog: focus moves in when it opens, Tab stays
  // inside it, Escape closes it, and focus returns to what opened it.
  useEffect(() => {
    if (!modalSheet) return;
    const sheet = sheetRef.current;
    const trigger = triggerRef.current;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const focusables = () =>
      Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => !el.closest("[hidden],[inert]") && el.getClientRects().length > 0);
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = !!active && !!sheet?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Focus that escapes the sheet (e.g. a click on the backdrop area) is pulled back in.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (!target || sheet?.contains(target) || document.querySelector("dialog[open]")) return;
      closeRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = prevOverflow;
      const target = returnTo && returnTo.isConnected && !sheet?.contains(returnTo) ? returnTo : trigger;
      target?.focus({ preventScroll: true });
    };
  }, [modalSheet, setOpen]);

  const closeOnMobile = () => {
    if (sheetMode) setOpen(false);
  };

  return (
    <>
      {sheetMode && open && <div className="fixed inset-0 z-40 bg-surface-3/75 backdrop-blur-[2px] animate-fade-in lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        ref={sheetRef}
        id="lesson-sidebar"
        role={modalSheet ? "dialog" : undefined}
        aria-modal={modalSheet ? true : undefined}
        aria-label={modalSheet ? undefined : "Course outline, notes and discussion"}
        aria-labelledby={modalSheet ? "lesson-sheet-title" : undefined}
        data-lesson-sheet-open={modalSheet ? "" : undefined}
        inert={hiddenSheet}
        className={cn(
          "flex flex-col bg-surface-1",
          // Mobile bottom sheet
          "fixed inset-x-0 bottom-0 z-50 h-[85dvh] rounded-t-2xl border-t border-border shadow-pop transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full",
          // Desktop sticky column
          "lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-14 lg:z-10 lg:h-[calc(100dvh-3.5rem)] lg:translate-y-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none lg:transition-none",
        )}
      >
        {/* Mobile sheet header */}
        <div className="relative flex items-center gap-2 border-b border-border px-4 pb-3 pt-4 lg:hidden">
          <span className="absolute left-1/2 top-1.5 block h-1 w-10 -translate-x-1/2 rounded-full bg-border-strong" aria-hidden="true" />
          <p id="lesson-sheet-title" className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {courseTitle}
          </p>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <Icon.X className="size-5" />
          </button>
        </div>

        {/* Course header (desktop) */}
        <div className="hidden border-b border-border bg-surface-2/40 px-5 py-4 lg:block">
          <p className="line-clamp-2 text-base font-semibold leading-snug text-ink">{courseTitle}</p>
          {progress && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Icon.TrendingUp className="size-3.5" /> Completed {progress.percent}%
                </span>
                <span className="tabular-nums text-ink-faint">
                  {progress.completed}/{progress.total} lessons
                </span>
              </div>
              <ProgressBar value={progress.percent} size="sm" tone="success" label="Course progress" />
            </div>
          )}
        </div>

        {/* Mobile progress line */}
        {progress && (
          <div className="border-b border-border px-4 py-2.5 lg:hidden">
            <div className="mb-1 flex justify-between text-xs text-ink-muted">
              <span>Completed {progress.percent}%</span>
              <span className="tabular-nums">
                {progress.completed}/{progress.total}
              </span>
            </div>
            <ProgressBar value={progress.percent} size="xs" tone="success" label="Course progress" />
          </div>
        )}

        {tabs.length > 1 && (
          <div role="tablist" aria-label="Sidebar sections" className="flex shrink-0 gap-1 border-b border-border px-2">
            {tabs.map((t) => {
              const active = t.value === tab;
              return (
                <button
                  key={t.value}
                  id={`sidebar-tab-${t.value}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`sidebar-panel-${t.value}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    e.stopPropagation();
                    const i = tabs.findIndex((x) => x.value === tab);
                    const nextTab = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
                    setTab(nextTab.value);
                    document.getElementById(`sidebar-tab-${nextTab.value}`)?.focus();
                  }}
                  className={cn(
                    "-mb-px inline-flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-sm font-medium transition-colors",
                    active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-muted")}>{t.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div data-sidebar-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          <div
            id="sidebar-panel-outline"
            role={tabs.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={tabs.length > 1 ? "sidebar-tab-outline" : undefined}
            hidden={tab !== "outline"}
          >
            <CourseOutlineNav outline={outline} currentLessonId={currentLessonId} tracking={tracking} showPreview={showPreview} onNavigate={closeOnMobile} />
          </div>
          {notesPanel && (
            <div id="sidebar-panel-notes" role="tabpanel" aria-labelledby="sidebar-tab-notes" hidden={tab !== "notes"}>
              {notesPanel}
            </div>
          )}
          {discussionPanel && (
            <div id="sidebar-panel-discussion" role="tabpanel" aria-labelledby="sidebar-tab-discussion" hidden={tab !== "discussion"} className="h-full">
              {discussionPanel}
            </div>
          )}
        </div>
      </aside>

      {/* Floating button that opens the sheet on small screens */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTab("outline");
          setOpen(true);
        }}
        aria-controls="lesson-sidebar"
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 right-4 z-30 inline-flex h-11 items-center gap-2 rounded-full border border-border-strong bg-surface-1 px-4 text-sm font-medium text-ink shadow-pop transition-colors hover:bg-surface-2 lg:hidden",
          open && "hidden",
        )}
      >
        <Icon.Layers className="size-4" />
        Chapters
      </button>
    </>
  );
}
