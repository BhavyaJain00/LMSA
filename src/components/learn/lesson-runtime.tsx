"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProgressStatus } from "@/lib/types";
import { completeLessonAction } from "@/lib/actions/progress";
import { useToast } from "@/components/ui/toast";
import type { LessonNeighbor, NoteItem, SidebarTab } from "./types";

/* ------------------------------------------------------------------ */
/* Video time store (updated every second without re-rendering the page) */
/* ------------------------------------------------------------------ */

export interface TimeStore {
  get: () => number;
  set: (time: number) => void;
  subscribe: (listener: () => void) => () => void;
}

function createTimeStore(): TimeStore {
  let current = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (time) => {
      if (time === current) return;
      current = time;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

export interface LessonRuntime {
  lessonId: string;
  lessonHref: string;
  courseHref: string;
  /** Effective status (optimistically "complete" right after completing). */
  status: ProgressStatus;
  /** Enrolled learner: progress is recorded. */
  tracking: boolean;
  completing: boolean;
  /** Requirements still missing after the last explicit completion attempt. */
  missing: string[] | null;
  dismissMissing: () => void;
  attemptComplete: (opts?: { silent?: boolean }) => Promise<boolean>;

  prev: LessonNeighbor | null;
  next: LessonNeighbor | null;
  /** Next is locked only until this lesson is complete (sequential courses). */
  nextUnlocksOnComplete: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  navigating: boolean;
  goPrev: () => void;
  goNext: () => Promise<void>;

  hasVideo: boolean;
  time: TimeStore;
  registerPrimaryVideo: (seek: (time: number) => void) => () => void;
  seekPrimary: (time: number) => void;
  onVideoWatched: () => void;
  onVideoEnded: () => void;

  notes: NoteItem[];
  notesEnabled: boolean;
  pendingQuote: string | null;
  startNoteFromQuote: (text: string) => void;
  clearQuote: () => void;
  registerQuoteFocus: (fn: (text: string) => boolean) => () => void;
  focusQuote: (text: string) => void;

  tab: SidebarTab;
  setTab: (tab: SidebarTab) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  openSidebar: (tab: SidebarTab) => void;
}

const RuntimeContext = createContext<LessonRuntime | null>(null);

export function useLessonRuntime(): LessonRuntime {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useLessonRuntime must be used inside <LessonRuntimeProvider>");
  return ctx;
}

/** For components that also render outside an open lesson (locked / preview states). */
export function useOptionalLessonRuntime(): LessonRuntime | null {
  return useContext(RuntimeContext);
}

const HEARTBEAT_SECONDS = 15;
const DESKTOP_QUERY = "(min-width: 1024px)";

interface HeartbeatResponse {
  ok: boolean;
  status?: ProgressStatus;
  dwellSeconds?: number;
  dwellRequired?: number;
  canComplete?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select, [contenteditable='true'], .ll-player, [role='slider'], [role='menu'], dialog");
}

export interface LessonRuntimeProviderProps {
  lessonId: string;
  lessonHref: string;
  courseHref: string;
  status: ProgressStatus;
  tracking: boolean;
  hasVideo: boolean;
  prev: LessonNeighbor | null;
  next: LessonNeighbor | null;
  nextUnlocksOnComplete: boolean;
  notes: NoteItem[];
  notesEnabled: boolean;
  initialTab: SidebarTab;
  children: ReactNode;
}

/**
 * Client-side brain of an open lesson: dwell-time heartbeats, completion,
 * prev/next navigation (with auto-complete), keyboard shortcuts, the bridge
 * between the video player and the notes panel, and sidebar state.
 */
export function LessonRuntimeProvider({
  lessonId,
  lessonHref,
  courseHref,
  status: serverStatus,
  tracking,
  hasVideo,
  prev,
  next,
  nextUnlocksOnComplete,
  notes,
  notesEnabled,
  initialTab,
  children,
}: LessonRuntimeProviderProps) {
  const router = useRouter();
  const toast = useToast();

  const [completedLocally, setCompletedLocally] = useState(false);
  const status: ProgressStatus = completedLocally ? "complete" : serverStatus;
  const [completing, setCompleting] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [tab, setTab] = useState<SidebarTab>(initialTab);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const [time] = useState(createTimeStore);

  const pendingDwell = useRef(0);
  const autoTried = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const primarySeek = useRef<((time: number) => void) | null>(null);
  const quoteFocus = useRef<((text: string) => boolean) | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /* ----------------------------- completion ----------------------------- */

  const attemptComplete = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!tracking) return false;
      if (statusRef.current === "complete") return true;
      if (inFlight.current) return inFlight.current;
      const run = (async () => {
        setCompleting(true);
        try {
          const dwellDelta = pendingDwell.current;
          pendingDwell.current = 0;
          const res = await completeLessonAction({ lessonId, dwellDelta });
          if (!res.ok) {
            if (!silent) toast.error("Could not complete the lesson", res.error);
            return false;
          }
          if (res.data.completed) {
            statusRef.current = "complete";
            setCompletedLocally(true);
            setMissing(null);
            if (!res.data.alreadyComplete) {
              if (res.data.courseCompleted) {
                const code = res.data.certificateCode;
                toast.toast({
                  title: "You completed the course!",
                  description: code ? "Your certificate is ready." : "Congratulations on finishing every lesson.",
                  tone: "success",
                  duration: 8000,
                  action: code ? { label: "View certificate", onClick: () => router.push(`/certificates/${code}`) } : undefined,
                });
              } else {
                toast.success("Lesson completed", `Course progress: ${res.data.courseProgress}%`);
              }
            }
            return true;
          }
          if (!silent) setMissing(res.data.missing);
          return false;
        } catch {
          if (!silent) toast.error("We could not save your progress", "Check your connection and try again.");
          return false;
        } finally {
          setCompleting(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = run;
      return run;
    },
    [tracking, lessonId, toast, router],
  );

  /* --------------------------- dwell heartbeat --------------------------- */

  const handleHeartbeat = useCallback(
    (res: HeartbeatResponse | null) => {
      if (!res?.ok || autoTried.current) return;
      const required = res.dwellRequired ?? 0;
      if (res.canComplete && required > 0 && (res.dwellSeconds ?? 0) >= required) {
        autoTried.current = true;
        void attemptComplete({ silent: true });
      }
    },
    [attemptComplete],
  );

  const sendHeartbeat = useCallback(
    (mode: "fetch" | "beacon") => {
      const dwellDelta = pendingDwell.current;
      pendingDwell.current = 0;
      const payload = JSON.stringify({ lessonId, dwellDelta });
      if (mode === "beacon" && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/lesson-progress", new Blob([payload], { type: "text/plain" }));
        return;
      }
      fetch("/api/lesson-progress", { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true })
        .then((r) => (r.ok ? (r.json() as Promise<HeartbeatResponse>) : null))
        .then(handleHeartbeat)
        .catch(() => {
          // Keep the seconds for the next heartbeat.
          pendingDwell.current += dwellDelta;
        });
    },
    [lessonId, handleHeartbeat],
  );

  // Record the view (status, current lesson pointer, activity) once per lesson.
  const viewSent = useRef(false);
  useEffect(() => {
    if (!tracking || viewSent.current) return;
    viewSent.current = true;
    sendHeartbeat("fetch");
  }, [tracking, sendHeartbeat]);

  // Count visible seconds and flush every 15s while the lesson is incomplete.
  const countDwell = tracking && status !== "complete";
  useEffect(() => {
    if (!countDwell) return;
    let ticks = 0;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pendingDwell.current += 1;
      ticks += 1;
      if (ticks % HEARTBEAT_SECONDS === 0) sendHeartbeat("fetch");
    }, 1000);
    const onHide = () => {
      if (document.visibilityState === "hidden" && pendingDwell.current > 0) sendHeartbeat("beacon");
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (pendingDwell.current > 0) sendHeartbeat("beacon");
    };
  }, [countDwell, sendHeartbeat]);

  /* ----------------------------- navigation ----------------------------- */

  const canGoPrev = !!prev && !prev.locked;
  const canGoNext = !!next && (!next.locked || nextUnlocksOnComplete);

  const goPrev = useCallback(() => {
    if (!prev || prev.locked) return;
    setNavigating(true);
    router.push(prev.href);
  }, [prev, router]);

  const goNext = useCallback(async () => {
    if (!next || (next.locked && !nextUnlocksOnComplete)) {
      router.push(courseHref);
      return;
    }
    if (tracking && statusRef.current !== "complete") {
      const done = await attemptComplete({ silent: !next.locked });
      if (next.locked && !done) {
        toast.toast({ title: "Complete this lesson to unlock the next one", tone: "warning" });
        document.getElementById("lesson-completion")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    setNavigating(true);
    router.push(next.href);
  }, [next, nextUnlocksOnComplete, tracking, attemptComplete, router, courseHref, toast]);

  // ← / → move between lessons when focus is not in a field or the player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (document.querySelector("dialog[open]")) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (e.key === "ArrowLeft" && canGoPrev) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && canGoNext) {
        e.preventDefault();
        void goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canGoPrev, canGoNext, goPrev, goNext]);

  /* ------------------------------- video -------------------------------- */

  const registerPrimaryVideo = useCallback((seek: (time: number) => void) => {
    primarySeek.current = seek;
    return () => {
      if (primarySeek.current === seek) primarySeek.current = null;
    };
  }, []);

  const seekPrimary = useCallback(
    (t: number) => {
      if (!primarySeek.current) return;
      if (!window.matchMedia(DESKTOP_QUERY).matches) setMobileSidebarOpen(false);
      primarySeek.current(t);
    },
    [],
  );

  const onVideoWatched = useCallback(() => {
    if (tracking && statusRef.current !== "complete") void attemptComplete({ silent: true });
  }, [tracking, attemptComplete]);

  const onVideoEnded = useCallback(() => {
    if (!tracking || statusRef.current === "complete") return;
    // Give the final watch heartbeat a moment to land before checking requirements.
    window.setTimeout(() => void attemptComplete({ silent: true }), 1200);
  }, [tracking, attemptComplete]);

  /* ------------------------------ notes --------------------------------- */

  const openSidebar = useCallback((target: SidebarTab) => {
    setTab(target);
    if (!window.matchMedia(DESKTOP_QUERY).matches) setMobileSidebarOpen(true);
  }, []);

  const startNoteFromQuote = useCallback(
    (text: string) => {
      setPendingQuote(text);
      openSidebar("notes");
    },
    [openSidebar],
  );

  const clearQuote = useCallback(() => setPendingQuote(null), []);

  const registerQuoteFocus = useCallback((fn: (text: string) => boolean) => {
    quoteFocus.current = fn;
    return () => {
      if (quoteFocus.current === fn) quoteFocus.current = null;
    };
  }, []);

  const focusQuote = useCallback(
    (text: string) => {
      if (!window.matchMedia(DESKTOP_QUERY).matches) setMobileSidebarOpen(false);
      const found = quoteFocus.current?.(text) ?? false;
      if (!found) toast.toast({ title: "This passage is no longer in the lesson", tone: "info" });
    },
    [toast],
  );

  const dismissMissing = useCallback(() => setMissing(null), []);

  // Deep links such as ?tab=discussion open the sheet on small screens.
  useEffect(() => {
    if (initialTab === "outline" || window.matchMedia(DESKTOP_QUERY).matches) return;
    const id = window.requestAnimationFrame(() => setMobileSidebarOpen(true));
    return () => window.cancelAnimationFrame(id);
  }, [initialTab]);

  const value = useMemo<LessonRuntime>(
    () => ({
      lessonId,
      lessonHref,
      courseHref,
      status,
      tracking,
      completing,
      missing,
      dismissMissing,
      attemptComplete,
      prev,
      next,
      nextUnlocksOnComplete,
      canGoPrev,
      canGoNext,
      navigating,
      goPrev,
      goNext,
      hasVideo,
      time,
      registerPrimaryVideo,
      seekPrimary,
      onVideoWatched,
      onVideoEnded,
      notes,
      notesEnabled,
      pendingQuote,
      startNoteFromQuote,
      clearQuote,
      registerQuoteFocus,
      focusQuote,
      tab,
      setTab,
      mobileSidebarOpen,
      setMobileSidebarOpen,
      openSidebar,
    }),
    [
      lessonId,
      lessonHref,
      courseHref,
      status,
      tracking,
      completing,
      missing,
      dismissMissing,
      attemptComplete,
      prev,
      next,
      nextUnlocksOnComplete,
      canGoPrev,
      canGoNext,
      navigating,
      goPrev,
      goNext,
      hasVideo,
      time,
      registerPrimaryVideo,
      seekPrimary,
      onVideoWatched,
      onVideoEnded,
      notes,
      notesEnabled,
      pendingQuote,
      startNoteFromQuote,
      clearQuote,
      registerQuoteFocus,
      focusQuote,
      tab,
      mobileSidebarOpen,
      openSidebar,
    ],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}
