"use client";

import Link from "next/link";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { TranscriptCue } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cueToHighlight } from "@/lib/transcripts/cues";
import { languageLabel } from "@/lib/transcripts/editor-shared";
import { serializeVtt } from "@/lib/transcripts/format";
import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  findPanelMatches,
  firstMatchFrom,
  foldCues,
  scrollTopFor,
  stepMatch,
  type PanelMatch,
  type TranscriptPayload,
  type TranscriptView,
} from "@/lib/transcripts/panel";
import type { TranscriptSearchResult } from "@/lib/transcripts/search";
import { useT } from "@/i18n/client";

/* ------------------------------------------------------------------ */
/* Loading a video's transcript                                         */
/* ------------------------------------------------------------------ */

export type LessonTranscriptState =
  | { status: "loading" }
  /** The viewer may not read it (or the video is gone): nothing is shown. */
  | { status: "hidden" }
  /** Loading failed (network or server error); the panel offers a retry. */
  | { status: "error" }
  | {
      status: "ready";
      /** Null when the video has no transcript. */
      transcript: TranscriptView | null;
      /** Course managers: a transcript is being generated. */
      pending: boolean;
      courseId: string;
      /** Course managers: the transcript editor of this video. */
      editHref: string | null;
      /** WebVTT blob URL of the transcript, for the player's caption track. */
      captionsUrl: string | null;
    };

const LOADING: LessonTranscriptState = { status: "loading" };
/** How often a transcript that is still being generated is checked again. */
const PENDING_POLL_MS = 15_000;

/**
 * Fetch the transcript of a lesson video for the current viewer. With
 * `captions` the cues are also turned into a WebVTT blob URL for the
 * player's caption track (used when the video has no caption file of its
 * own); the URL is revoked when the transcript is reloaded or the component
 * goes away.
 */
export function useLessonTranscript(lessonId: string, blockId: string, opts: { captions: boolean }): { state: LessonTranscriptState; reload: () => void } {
  const key = `${lessonId}/${blockId}`;
  const [loaded, setLoaded] = useState<{ key: string; state: LessonTranscriptState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { captions } = opts;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let poll: number | undefined;
    fetch(`/api/transcripts/${encodeURIComponent(lessonId)}/${encodeURIComponent(blockId)}`, {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setLoaded({ key, state: { status: "hidden" } });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as TranscriptPayload;
        if (controller.signal.aborted) return;
        const transcript = body.transcript?.cues.length ? body.transcript : null;
        if (transcript && captions) {
          objectUrl = URL.createObjectURL(new Blob([serializeVtt(transcript.cues, { language: transcript.language })], { type: "text/vtt" }));
        }
        setLoaded({ key, state: { status: "ready", transcript, pending: !!body.pending, courseId: body.courseId, editHref: body.editHref ?? null, captionsUrl: objectUrl } });
        if (body.pending) poll = window.setTimeout(() => setAttempt((n) => n + 1), PENDING_POLL_MS);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoaded({ key, state: { status: "error" } });
      });
    return () => {
      controller.abort();
      if (poll) window.clearTimeout(poll);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [lessonId, blockId, key, captions, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state: loaded?.key === key ? loaded.state : LOADING, reload };
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

export interface TranscriptPanelProps {
  lessonId: string;
  blockId: string;
  state: LessonTranscriptState;
  onReload: () => void;
  /** The server already knows this video has a transcript: hold its place while it loads. */
  expected?: boolean;
  /** The lesson video this transcript belongs to (null until it is mounted). */
  getVideo: () => HTMLVideoElement | null;
  /** Move the video to `time` seconds and play. */
  onSeek: (time: number) => void;
}

const FRAME = "mt-3 rounded-lg border border-border bg-surface-1";

/**
 * Interactive transcript under a lesson video: the line being spoken is
 * highlighted and kept in view (until the reader scrolls away), every line
 * seeks the video, the text can be searched with match navigation (and the
 * same words looked up in the other lessons of the course), and the
 * transcript can be downloaded as text or captions.
 *
 * Renders nothing for a video without a transcript, except for course
 * managers, who get a pointer to the transcript editor.
 */
export function TranscriptPanel({ lessonId, blockId, state, onReload, expected, getVideo, onSeek }: TranscriptPanelProps) {
  const t = useT("learning");
  const common = useT("common");
  if (state.status === "hidden") return null;

  if (state.status === "loading") {
    if (!expected) return null;
    return (
      <div className={cn(FRAME, "flex items-center gap-2 px-3 py-2.5")} role="status" aria-label={t("learn.transcript.loading")}>
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={cn(FRAME, "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-ink-muted")} role="alert">
        <span className="flex min-w-0 items-center gap-2">
          <Icon.AlertTriangle className="size-4 shrink-0 text-warning" />
          {t("learn.transcript.loadFailed")}
        </span>
        <Button size="xs" variant="outline" onClick={onReload} leftIcon={<Icon.Refresh className="size-3.5" />}>
          {common("actions.tryAgain")}
        </Button>
      </div>
    );
  }

  if (!state.transcript) {
    // Learners see nothing for a video without a transcript; managers get the way to add one.
    if (!state.editHref) return null;
    return (
      <div className={cn(FRAME, "flex flex-wrap items-center justify-between gap-2 border-dashed px-3 py-2 text-sm text-ink-muted")}>
        <span className="flex min-w-0 items-center gap-2" role={state.pending ? "status" : undefined}>
          {state.pending ? <Icon.Loader className="size-4 shrink-0 animate-spin-slow" /> : <Icon.Captions className="size-4 shrink-0" />}
          {state.pending ? t("learn.transcript.pending") : t("learn.transcript.none")}
        </span>
        <Link href={state.editHref} className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline">
          {state.pending ? t("learn.transcript.openEditor") : t("learn.transcript.add")}
        </Link>
      </div>
    );
  }

  return (
    <TranscriptBody
      key={`${state.transcript.id}@${state.transcript.updatedAt}`}
      lessonId={lessonId}
      blockId={blockId}
      transcript={state.transcript}
      courseId={state.courseId}
      editHref={state.editHref}
      getVideo={getVideo}
      onSeek={onSeek}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Preferences and playback position                                    */
/* ------------------------------------------------------------------ */

const OPEN_PREF_KEY = "ll-transcript-open";

function readOpenPref(): boolean {
  try {
    return localStorage.getItem(OPEN_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveOpenPref(open: boolean) {
  try {
    localStorage.setItem(OPEN_PREF_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable (private mode): the choice lasts for this page only */
  }
}

const VIDEO_EVENTS = ["timeupdate", "seeked", "loadedmetadata", "emptied"] as const;

/** Index of the cue to highlight, following the video element's clock (-1 before the first cue or without a loaded video). */
function useActiveCue(cues: readonly TranscriptCue[], getVideo: () => HTMLVideoElement | null): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const video = getVideo();
      if (!video) return () => undefined;
      for (const name of VIDEO_EVENTS) video.addEventListener(name, notify);
      return () => {
        for (const name of VIDEO_EVENTS) video.removeEventListener(name, notify);
      };
    },
    [getVideo],
  );
  const getSnapshot = useCallback(() => {
    const video = getVideo();
    return video && video.readyState >= 1 ? cueToHighlight(cues, video.currentTime) : -1;
  }, [cues, getVideo]);
  return useSyncExternalStore(subscribe, getSnapshot, () => -1);
}

/* ------------------------------------------------------------------ */
/* Cue rows                                                             */
/* ------------------------------------------------------------------ */

/** `text` with the given character ranges wrapped in <mark>; the range starting at `current` is emphasized. */
function highlight(text: string, ranges: readonly { start: number; end: number }[] | undefined, current = -1): ReactNode {
  if (!ranges?.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start < at || r.end <= r.start) continue;
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(
      <mark key={r.start} className={cn("rounded-sm px-0.5", r.start === current ? "bg-accent text-accent-fg" : "bg-warning/30 text-ink")}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

interface CueRowProps {
  index: number;
  cue: TranscriptCue;
  active: boolean;
  /** The one row in the tab order (roving tabindex). */
  tabbable: boolean;
  marks: readonly PanelMatch[] | undefined;
  /** Start offset of the selected match when it is in this row, else -1. */
  currentMark: number;
  /** Long transcripts skip rendering rows that are scrolled out of view. */
  lazy: boolean;
  onActivate: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onFocus: (index: number) => void;
}

const CueRow = memo(function CueRow({ index, cue, active, tabbable, marks, currentMark, lazy, onActivate, onKeyDown, onFocus }: CueRowProps) {
  const t = useT("learning");
  return (
    <li data-cue={index} className={lazy ? "[contain-intrinsic-size:auto_2.25rem] [content-visibility:auto]" : undefined}>
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-current={active ? "true" : undefined}
        onClick={() => onActivate(index)}
        onKeyDown={(e) => onKeyDown(e, index)}
        onFocus={() => onFocus(index)}
        className={cn(
          "flex w-full items-start gap-3 rounded-md border-s-2 px-2 py-1.5 text-start text-sm leading-relaxed transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
          active ? "border-accent bg-accent/10 text-ink" : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
        )}
      >
        <span className="w-12 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-accent" dir="ltr">
          <span className="sr-only">{t("learn.transcript.playFrom")} </span>
          {formatTime(cue.start)}
        </span>
        <span dir="auto" className="min-w-0 flex-1 break-words">
          {highlight(cue.text, marks, currentMark)}
        </span>
      </button>
    </li>
  );
});

/* ------------------------------------------------------------------ */
/* The transcript itself                                                */
/* ------------------------------------------------------------------ */

/** Auto-scroll resumes this long after the reader stopped scrolling (unless they are still in the list). */
const RESUME_FOLLOW_MS = 5000;
/** Rows beyond this count are rendered lazily. */
const LAZY_ROWS_FROM = 400;
const DOWNLOADS = [
  { format: "txt", label: "learn.transcript.formatText", title: "learn.transcript.downloadTxt" },
  { format: "vtt", label: null, name: "WebVTT", title: "learn.transcript.downloadVtt" },
  { format: "srt", label: null, name: "SubRip", title: "learn.transcript.downloadSrt" },
] as const;

type CourseSearch =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "error"; query: string; network: boolean }
  | { status: "ready"; query: string; results: TranscriptSearchResult[] };

interface TranscriptBodyProps {
  lessonId: string;
  blockId: string;
  transcript: TranscriptView;
  courseId: string;
  editHref: string | null;
  getVideo: () => HTMLVideoElement | null;
  onSeek: (time: number) => void;
}

function TranscriptBody({ lessonId, blockId, transcript, courseId, editHref, getVideo, onSeek }: TranscriptBodyProps) {
  const t = useT("learning");
  const common = useT("common");
  const { cues } = transcript;
  const bodyId = useId();
  const scrollerRef = useRef<HTMLOListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(readOpenPref);
  const activeIndex = useActiveCue(cues, getVideo);

  /* ------------------------------ search ------------------------------ */
  const [search, setSearch] = useState<{ query: string; anchor: number; step: number | null }>({ query: "", anchor: -1, step: null });
  const deferredQuery = useDeferredValue(search.query);
  const folded = useMemo(() => foldCues(cues), [cues]);
  const { matches, truncated } = useMemo(() => findPanelMatches(cues, deferredQuery, folded), [cues, deferredQuery, folded]);
  const searching = search.query.trim().length >= MIN_QUERY_LENGTH;
  const matchIndex = matches.length ? Math.min(search.step ?? firstMatchFrom(matches, search.anchor), matches.length - 1) : -1;
  const currentMatch = matchIndex >= 0 ? matches[matchIndex]! : null;
  const marksByCue = useMemo(() => {
    const map = new Map<number, PanelMatch[]>();
    for (const m of matches) {
      const list = map.get(m.cue);
      if (list) list.push(m);
      else map.set(m.cue, [m]);
    }
    return map;
  }, [matches]);

  const [course, setCourse] = useState<CourseSearch>({ status: "idle" });
  const courseRequest = useRef<AbortController | null>(null);

  const changeQuery = (value: string) => {
    courseRequest.current?.abort();
    setCourse({ status: "idle" });
    // A new search starts at the line being spoken.
    setSearch({ query: value, anchor: activeIndex, step: null });
  };
  const stepBy = (delta: number) => {
    if (matches.length) setSearch((s) => ({ ...s, step: stepMatch(matchIndex, matches.length, delta) }));
  };

  const searchCourse = useCallback(
    (query: string) => {
      courseRequest.current?.abort();
      const controller = new AbortController();
      courseRequest.current = controller;
      setCourse({ status: "loading", query });
      fetch(`/api/transcripts/search?q=${encodeURIComponent(query)}&courseId=${encodeURIComponent(courseId)}&limit=30`, {
        signal: controller.signal,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; results?: TranscriptSearchResult[] } | null;
          if (controller.signal.aborted) return;
          if (!res.ok || !body?.ok) {
            setCourse({ status: "error", query, network: false });
            return;
          }
          // This video's own matches are already highlighted above.
          setCourse({ status: "ready", query, results: (body.results ?? []).filter((r) => !(r.lessonId === lessonId && r.blockId === blockId)) });
        })
        .catch(() => {
          if (!controller.signal.aborted) setCourse({ status: "error", query, network: true });
        });
    },
    [courseId, lessonId, blockId],
  );
  useEffect(() => () => courseRequest.current?.abort(), []);

  /* --------------------------- following the video --------------------------- */
  const [following, setFollowing] = useState(true);
  /** Scroll events before this time (performance.now) come from our own scrolling. */
  const ownScrollUntil = useRef(0);
  const resumeTimer = useRef<number | undefined>(undefined);

  const scrollToCue = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-cue="${index}"]`);
    if (!scroller || !row) return;
    const box = scroller.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const top = scrollTopFor(
      { top: rowBox.top - box.top + scroller.scrollTop, height: rowBox.height },
      { scrollTop: scroller.scrollTop, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight },
    );
    if (top === null) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ownScrollUntil.current = performance.now() + (smooth ? 900 : 150);
    scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const pauseFollowing = useCallback(() => {
    setFollowing(false);
    window.clearTimeout(resumeTimer.current);
    const wait = () => {
      resumeTimer.current = window.setTimeout(() => {
        const scroller = scrollerRef.current;
        // Still reading (pointer over the list) or moving through it with the keyboard: keep it where it is.
        if (scroller && (scroller.matches(":hover") || scroller.querySelector(":focus-visible"))) wait();
        else setFollowing(true);
      }, RESUME_FOLLOW_MS);
    };
    wait();
  }, []);
  const resumeFollowing = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    setFollowing(true);
  }, []);
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const showList = open && course.status === "idle";
  // Keep the spoken line in view while following (search navigation takes over while a search is active).
  useEffect(() => {
    if (showList && following && !searching && activeIndex >= 0) scrollToCue(activeIndex);
  }, [showList, following, searching, activeIndex, scrollToCue]);
  const matchCue = currentMatch?.cue ?? -1;
  const matchStart = currentMatch?.start ?? -1;
  useEffect(() => {
    if (showList && matchCue >= 0) scrollToCue(matchCue);
  }, [showList, matchCue, matchStart, scrollToCue]);

  /* ------------------------------ cue rows ------------------------------ */
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const tabStop = focusedRow ?? Math.max(activeIndex, 0);

  const activate = useCallback(
    (index: number) => {
      const cue = cues[index];
      if (!cue) return;
      onSeek(cue.start);
      resumeFollowing();
    },
    [cues, onSeek, resumeFollowing],
  );

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = cues.length - 1;
      let target: number;
      switch (event.key) {
        case "ArrowDown":
          target = Math.min(last, index + 1);
          break;
        case "ArrowUp":
          target = Math.max(0, index - 1);
          break;
        case "PageDown":
          target = Math.min(last, index + 8);
          break;
        case "PageUp":
          target = Math.max(0, index - 8);
          break;
        case "Home":
          target = 0;
          break;
        case "End":
          target = last;
          break;
        case "ArrowLeft":
        case "ArrowRight":
          // The lesson page maps these to the previous / next lesson; not while moving through the lines.
          event.preventDefault();
          return;
        default:
          return;
      }
      event.preventDefault();
      scrollerRef.current?.querySelector<HTMLButtonElement>(`[data-cue="${target}"] > button`)?.focus();
    },
    [cues.length],
  );

  const toggleOpen = () => {
    setOpen((value) => {
      saveOpenPref(!value);
      return !value;
    });
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stepBy(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && search.query) {
      event.preventDefault();
      event.stopPropagation();
      changeQuery("");
    }
  };

  const matchLabel = !searching
    ? t("learn.transcript.keepTyping")
    : !matches.length
      ? t("learn.transcript.noMatches")
      : t(truncated ? "learn.transcript.matchPositionMore" : "learn.transcript.matchPosition", { index: matchIndex + 1, total: matches.length });
  const language = languageLabel(transcript.language);
  const lazy = cues.length > LAZY_ROWS_FROM;
  const downloadBase = `/api/transcripts/${encodeURIComponent(lessonId)}/${encodeURIComponent(blockId)}`;

  return (
    <section className={FRAME} aria-label={t("learn.transcript.title")}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggleOpen}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon.FileText className="size-4 shrink-0 text-ink-muted" /> {t("learn.transcript.title")}
            <span className="truncate rounded-full bg-surface-2 px-1.5 text-xs font-normal text-ink-muted">{language}</span>
          </span>
          <Icon.ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
        </button>
      </h3>

      <div id={bodyId} hidden={!open}>
        {open && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2" role="search">
              <div className="min-w-0 flex-1 basis-44">
                <Input
                  ref={searchRef}
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={search.query}
                  maxLength={MAX_QUERY_LENGTH}
                  onChange={(e) => changeQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={t("learn.transcript.search")}
                  aria-label={t("learn.transcript.search")}
                  leftAddon={<Icon.Search className="size-4" />}
                />
              </div>
              {search.query && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <span aria-live="polite" className="me-1 min-w-14 text-end text-xs tabular-nums text-ink-muted">
                    {matchLabel}
                  </span>
                  <IconButton label={t("learn.transcript.previousMatch")} size="icon-sm" disabled={!matches.length || course.status !== "idle"} onClick={() => stepBy(-1)}>
                    <Icon.ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton label={t("learn.transcript.nextMatch")} size="icon-sm" disabled={!matches.length || course.status !== "idle"} onClick={() => stepBy(1)}>
                    <Icon.ChevronDown className="size-4" />
                  </IconButton>
                  <IconButton
                    label={t("learn.transcript.clearSearch")}
                    size="icon-sm"
                    onClick={() => {
                      changeQuery("");
                      searchRef.current?.focus();
                    }}
                  >
                    <Icon.X className="size-4" />
                  </IconButton>
                </div>
              )}
            </div>

            {course.status === "idle" ? (
              <div className="relative border-t border-border">
                <ol
                  ref={scrollerRef}
                  lang={transcript.language}
                  aria-label={t("learn.transcript.lines")}
                  onScroll={() => {
                    if (performance.now() >= ownScrollUntil.current) pauseFollowing();
                  }}
                  onWheel={pauseFollowing}
                  onTouchMove={pauseFollowing}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setFocusedRow(null);
                  }}
                  className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain p-1.5 scrollbar-thin sm:max-h-80"
                >
                  {cues.map((cue, i) => (
                    <CueRow
                      key={i}
                      index={i}
                      cue={cue}
                      active={i === activeIndex}
                      tabbable={i === tabStop}
                      marks={marksByCue.get(i)}
                      currentMark={matchCue === i ? matchStart : -1}
                      lazy={lazy}
                      onActivate={activate}
                      onKeyDown={onRowKeyDown}
                      onFocus={setFocusedRow}
                    />
                  ))}
                </ol>
                {!following && !searching && activeIndex >= 0 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                    <Button size="xs" variant="secondary" className="pointer-events-auto shadow-pop" onClick={resumeFollowing} leftIcon={<Icon.ChevronsUpDown className="size-3.5" />}>
                      {t("learn.transcript.jumpToCurrent")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <CourseResults
                search={course}
                onRetry={() => searchCourse(course.query)}
                onBack={() => {
                  courseRequest.current?.abort();
                  setCourse({ status: "idle" });
                }}
              />
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-3 py-2 text-xs text-ink-muted">
              {searching && course.status === "idle" && (
                <button type="button" onClick={() => searchCourse(search.query.trim())} className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline">
                  <Icon.Search className="size-3.5" /> {t("learn.transcript.searchCourse")}
                </button>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Icon.Download className="size-3.5" aria-hidden="true" />
                <span>{common("actions.download")}</span>
                {DOWNLOADS.map((d) => (
                  <a
                    key={d.format}
                    href={`${downloadBase}?format=${d.format}`}
                    download
                    title={t(d.title)}
                    aria-label={t(d.title)}
                    className="font-medium text-ink underline-offset-4 hover:text-accent hover:underline"
                  >
                    {d.label ? t(d.label) : d.name}
                  </a>
                ))}
              </span>
              {editHref && (
                <Link href={editHref} className="inline-flex items-center gap-1.5 font-medium text-ink underline-offset-4 hover:text-accent hover:underline">
                  <Icon.Edit className="size-3.5" /> {t("learn.transcript.edit")}
                </Link>
              )}
              {transcript.source === "auto" && <span className="basis-full text-ink-faint sm:ms-auto sm:basis-auto">{t("learn.transcript.auto")}</span>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Matches in the other lessons of the course                           */
/* ------------------------------------------------------------------ */

function CourseResults({ search, onRetry, onBack }: { search: Exclude<CourseSearch, { status: "idle" }>; onRetry: () => void; onBack: () => void }) {
  const t = useT("learning");
  const common = useT("common");
  const lessons = search.status === "ready" ? search.results.length : 0;
  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="min-w-0 truncate text-xs font-medium text-ink-muted" aria-live="polite">
          {search.status === "ready" && lessons > 0 ? t("learn.transcript.otherVideos", { count: lessons, query: search.query }) : t("learn.transcript.inCourse", { query: search.query })}
        </p>
        <Button size="xs" variant="ghost" onClick={onBack} leftIcon={<Icon.ArrowLeft className="size-3.5 rtl:rotate-180" />}>
          {t("learn.transcript.back")}
        </Button>
      </div>

      {search.status === "loading" && (
        <div className="space-y-2 px-3 pb-3" role="status" aria-label={t("learn.transcript.searchingCourse")}>
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      )}

      {search.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 text-sm text-ink-muted" role="alert">
          <span className="flex min-w-0 items-center gap-2">
            <Icon.AlertTriangle className="size-4 shrink-0 text-warning" />
            {search.network ? t("learn.transcript.searchFailedNetwork") : t("learn.transcript.searchFailed")}
          </span>
          <Button size="xs" variant="outline" onClick={onRetry}>
            {common("actions.tryAgain")}
          </Button>
        </div>
      )}

      {search.status === "ready" && lessons === 0 && (
        <p className="px-3 pb-3 text-sm text-ink-muted">{t("learn.transcript.noCourseResults", { query: search.query })}</p>
      )}

      {search.status === "ready" && lessons > 0 && (
        <ul className="max-h-72 space-y-2 overflow-y-auto overscroll-contain px-1.5 pb-2 scrollbar-thin sm:max-h-80">
          {search.results.map((result) => (
            <li key={`${result.lessonId}/${result.blockId}`}>
              <p className="flex items-baseline justify-between gap-2 px-2 text-sm">
                <Link href={result.href} className="min-w-0 truncate font-medium text-ink underline-offset-4 hover:text-accent hover:underline">
                  {result.lessonTitle}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {t("learn.transcript.matches", { count: result.totalMatches })}
                </span>
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {result.matches.map((match) => (
                  <li key={match.start}>
                    <Link href={match.href} className="flex items-start gap-3 rounded-md px-2 py-1.5 text-sm leading-relaxed text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
                      <span className="w-12 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-accent" dir="ltr">{formatTime(match.start)}</span>
                      <span dir="auto" className="min-w-0 flex-1 break-words">
                        {highlight(
                          match.snippet,
                          match.ranges.map(([start, end]) => ({ start, end })),
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
