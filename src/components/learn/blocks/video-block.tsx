"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VideoChapterMarker, VideoQuizMarker, VideoSource } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { languageLabel } from "@/lib/transcripts/editor-shared";
import { parseTimeParam } from "@/lib/transcripts/panel";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { LessonVideo } from "../lesson-video";
import { useLearnPrefs } from "../learn-provider";
import { useLessonRuntime } from "../lesson-runtime";
import { TranscriptPanel, useLessonTranscript } from "../transcript-panel";

/** Site-wide player options for the viewer (from Settings → Video). */
export interface VideoBlockPlayerOptions {
  watermark: { text: string; opacity: number } | null;
  seekThumbnails: boolean;
  autoplayNext: boolean;
  /** Lifetime of the pre-signed URLs (seconds) while protection is on. */
  signedUrlTtlSeconds?: number | null;
}

export interface VideoBlockProps {
  blockId: string;
  /** Playable src (pre-signed by the server for protected uploads). */
  src: string;
  /** Extra renditions for the quality menu (pre-signed as well). */
  sources?: VideoSource[];
  posterUrl?: string;
  captionsUrl?: string;
  title?: string;
  chapters?: VideoChapterMarker[];
  quizMarkers?: VideoQuizMarker[];
  startAt?: number;
  initialMaxPosition?: number;
  preventSkipping: boolean;
  /** The first video of the lesson: timestamped notes seek this one. */
  primary: boolean;
  /** Pre-rendered quiz blocks for the in-video quiz markers, by quiz id. */
  quizNodes: Record<string, ReactNode>;
  quizTitles: Record<string, string>;
  passedQuizIds: string[];
  /** Watermark, seek previews and autoplay-next settings. */
  player?: VideoBlockPlayerOptions;
  /** The last video of the lesson: only it counts down to the next lesson. */
  lastVideo?: boolean;
  /** Round 3: HLS master playlist (pre-signed when protected) for adaptive streaming; `src` stays the fallback. */
  hlsUrl?: string;
  /** Round 3: the block's `transcriptId`, when the server passes it: the transcript panel then holds its place while loading. */
  transcriptId?: string;
  /**
   * The lesson header (meta line, title, Previous / Next) when this video opens the lesson: it is
   * shown right under the player, above the chapter list and transcript (video first, then title).
   */
  header?: ReactNode;
}

interface ActiveQuiz {
  quizId: string;
  time: number;
  resume: () => void;
}

const COUNTDOWN = 7;

/** Keys the player uses as shortcuts; they must not reach it while a quiz is open. */
const PLAYER_KEYS = new Set([" ", "k", "j", "l", "m", "f", "c", "p", "t", "?", ",", ".", "<", ">", "home", "end", "arrowleft", "arrowright", "arrowup", "arrowdown"]);

/**
 * A lesson video with resume, notes seeking, in-video quizzes, a chapter
 * list and an interactive transcript (which also feeds the player's captions
 * when the video has no caption file). `?t=<time>` in the lesson URL starts
 * the lesson's first video there; `&block=<id>` names another video.
 */
export function VideoBlock({
  blockId,
  src,
  sources,
  posterUrl,
  captionsUrl,
  title,
  chapters,
  quizMarkers,
  startAt,
  initialMaxPosition,
  preventSkipping,
  primary,
  quizNodes,
  quizTitles,
  passedQuizIds,
  player,
  lastVideo = true,
  hlsUrl,
  transcriptId,
  header,
}: VideoBlockProps) {
  const rt = useLessonRuntime();
  const t = useT("learning");
  const { theater, toggleTheater } = useLearnPrefs();
  const searchParams = useSearchParams();

  // A timestamp link (transcript search, AI tutor citations): `?t=` for the first video, `&block=` for another one.
  const linkBlock = searchParams.get("block");
  const linkTime = (linkBlock ? linkBlock === blockId : primary) ? parseTimeParam(searchParams.get("t")) : null;
  // A link must not get around "prevent skipping".
  const linkedTime = linkTime !== null && (!preventSkipping || linkTime <= (initialMaxPosition ?? 0) + 1) ? linkTime : null;
  const linkKey = linkedTime === null ? "" : `${linkBlock ?? ""}@${linkedTime}`;

  const [initial] = useState(() => ({ startAt: linkedTime ?? startAt, initialMaxPosition }));
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | undefined>(undefined);
  const [active, setActive] = useState<ActiveQuiz | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  // The first link is the start position; a later one (navigating within the same lesson) seeks.
  const [appliedLink, setAppliedLink] = useState(linkKey);
  if (linkKey !== appliedLink) {
    setAppliedLink(linkKey);
    if (linkedTime !== null) setSeek((s) => ({ time: linkedTime, key: (s?.key ?? 0) + 1, play: false }));
  }
  useEffect(() => {
    if (!linkKey) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    playerRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [linkKey]);

  const seekTo = useCallback((time: number, play = true) => {
    setSeek((s) => ({ time, key: (s?.key ?? 0) + 1, play }));
    playerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  /* ----------------------------- transcript ----------------------------- */
  const transcript = useLessonTranscript(rt.lessonId, blockId, { captions: !captionsUrl });
  const loadedTranscript = transcript.state.status === "ready" ? transcript.state : null;
  // Captions come from the transcript when the video has no caption file of its own.
  const transcriptCaptions = captionsUrl ? null : (loadedTranscript?.captionsUrl ?? null);
  const transcriptLanguage = loadedTranscript?.transcript?.language;
  const getVideo = useCallback(() => wrapperRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]") ?? null, []);
  const quizOpen = !!active;
  // The transcript sits right under the video (which docks as a mini-player when scrolled away): seek without moving the page.
  const seekFromTranscript = useCallback(
    (time: number) => {
      if (!quizOpen) setSeek((s) => ({ time, key: (s?.key ?? 0) + 1, play: true }));
    },
    [quizOpen],
  );

  const { registerPrimaryVideo } = rt;
  useEffect(() => {
    if (!primary) return;
    return registerPrimaryVideo((time) => seekTo(time, true));
  }, [primary, registerPrimaryVideo, seekTo]);

  const onQuizMarker = useCallback((quizId: string, resume: () => void) => {
    if (typeof document !== "undefined" && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    // Markers clicked on the seek bar do not pause playback by themselves.
    wrapperRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]")?.pause();
    // A docked mini-player returns to its place: bring the quiz into view.
    const rect = playerRef.current?.getBoundingClientRect();
    if (rect && (rect.bottom < 0 || rect.top > window.innerHeight)) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      playerRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
    const marker = quizMarkers?.find((m) => m.quizId === quizId);
    setActive({ quizId, resume, time: marker?.time ?? 0 });
  }, [quizMarkers]);

  const continueVideo = useCallback(() => {
    active?.resume();
    setActive(null);
  }, [active]);

  const sortedMarkers = quizMarkers?.length ? [...quizMarkers].sort((a, b) => a.time - b.time) : [];

  return (
    <div ref={wrapperRef} className={cn("mx-auto w-full", theater ? "max-w-[min(100%,calc((100dvh_-_9rem)*16/9))]" : "max-w-(--lesson-w)")} data-no-highlight>
      {sortedMarkers.length > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-ink-muted">
          <p className="font-medium text-ink">
            {t("learn.video.quizList", { count: sortedMarkers.length })}
          </p>
          <ol className="mt-1 space-y-0.5">
            {sortedMarkers.map((m, i) => (
              <li key={`${m.quizId}@${m.time}`} className="flex items-center gap-2">
                <span className="tabular-nums text-ink-faint">{i + 1}.</span>
                <span className="min-w-0 truncate">{quizTitles[m.quizId] ?? t("learn.video.quiz")}</span>
                <span className="text-ink-faint">{t("learn.video.quizAt")}</span>
                <span className="font-medium tabular-nums text-ink">{formatTime(m.time)}</span>
                {passedQuizIds.includes(m.quizId) && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <Icon.CheckCircle className="size-3.5" /> {t("learn.video.passed")}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div ref={playerRef}>
        <LessonVideo
          lessonId={rt.lessonId}
          blockId={blockId}
          src={src}
          sources={sources}
          hlsUrl={hlsUrl}
          posterUrl={posterUrl}
          captionsUrl={captionsUrl || transcriptCaptions || undefined}
          captionsLabel={transcriptCaptions && transcriptLanguage ? languageLabel(transcriptLanguage) : undefined}
          captionsLang={transcriptCaptions ? transcriptLanguage : undefined}
          title={title}
          chapters={chapters}
          quizMarkers={quizMarkers}
          startAt={initial.startAt}
          initialMaxPosition={initial.initialMaxPosition}
          preventSkipping={preventSkipping}
          track={rt.tracking}
          onCompleted={rt.onVideoWatched}
          onEnded={rt.onVideoEnded}
          onQuizMarker={onQuizMarker}
          onNext={rt.canGoNext ? () => void rt.goNext() : undefined}
          nextLabel={rt.next?.locked ? t("learn.nav.completeAndContinue") : t("learn.nextLesson")}
          nextTitle={rt.next?.title}
          autoplayNext={!!player?.autoplayNext && lastVideo && !active}
          watermark={player?.watermark ?? null}
          seekThumbnails={player?.seekThumbnails ?? false}
          signedUrlTtlSeconds={player?.signedUrlTtlSeconds ?? null}
          miniPlayer
          theater={theater}
          onToggleTheater={toggleTheater}
          seekRequest={seek}
          onTimeChange={primary ? rt.time.set : undefined}
          className={active ? "min-h-[min(36rem,85vh)]" : undefined}
          overlay={
            active ? (
              <QuizOverlay
                key={`${active.quizId}@${active.time}`}
                active={active}
                title={quizTitles[active.quizId] ?? t("learn.video.quiz")}
                passed={passedQuizIds.includes(active.quizId)}
                node={quizNodes[active.quizId]}
                onContinue={continueVideo}
              />
            ) : undefined
          }
        />
      </div>

      {header && <div className="mt-5">{header}</div>}

      {chapters && chapters.length > 1 && (
        <details className={cn("group rounded-xl border border-border bg-surface-1", header ? "mt-6" : "mt-3")}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <Icon.Layers className="size-4 text-ink-muted" /> {t("learn.video.chapters")}
              <span className="rounded-full bg-surface-2 px-1.5 text-xs text-ink-muted">{chapters.length}</span>
            </span>
            <Icon.ChevronDown className="size-4 text-ink-faint transition-transform group-open:rotate-180" />
          </summary>
          <ol className="border-t border-border p-1.5">
            {chapters.map((c) => (
              <li key={`${c.time}-${c.title}`}>
                <button
                  type="button"
                  onClick={() => seekTo(c.time)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-accent" dir="ltr">{formatTime(c.time)}</span>
                  <span className="min-w-0 truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}

      <TranscriptPanel
        lessonId={rt.lessonId}
        blockId={blockId}
        state={transcript.state}
        onReload={transcript.reload}
        expected={!!transcriptId}
        getVideo={getVideo}
        onSeek={seekFromTranscript}
      />
    </div>
  );
}

function QuizOverlay({
  active,
  title,
  passed,
  node,
  onContinue,
}: {
  active: ActiveQuiz;
  title: string;
  passed: boolean;
  node: ReactNode;
  onContinue: () => void;
}) {
  const t = useT("learning");
  const rootRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [seconds, setSeconds] = useState(COUNTDOWN);
  const phase: "countdown" | "quiz" = opened || seconds <= 0 ? "quiz" : "countdown";

  // Countdown before the quiz opens.
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Move focus into the overlay whenever its phase changes.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [phase]);

  // Keep the player's keyboard shortcuts from firing while the quiz is open.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      if (PLAYER_KEYS.has(e.key.toLowerCase()) || /^[0-9]$/.test(e.key)) e.stopPropagation();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  if (phase === "countdown") {
    return (
      <div ref={rootRef} className="flex size-full items-center justify-center bg-black/70 p-4 animate-fade-in">
        <div
          role="alertdialog"
          aria-labelledby="video-quiz-title"
          aria-describedby="video-quiz-desc"
          className="w-full max-w-sm rounded-xl border border-border bg-surface-1 p-5 text-ink shadow-pop"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <Icon.ListChecks className="size-5" />
            </span>
            <div className="min-w-0">
              <p id="video-quiz-title" className="font-semibold">
                {t("learn.video.timeForQuiz")}
              </p>
              <p id="video-quiz-desc" className="mt-1 text-sm text-ink-muted">
                {t.rich("learn.video.quizCountdown", { seconds, b: (chunks) => <span className="font-medium tabular-nums text-ink">{chunks}</span> })}
              </p>
              {passed && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success">
                  <Icon.CheckCircle className="size-3.5" /> {t("learn.video.alreadyPassed")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onContinue}>
              {t("learn.video.continue")}
            </Button>
            <Button data-autofocus size="sm" onClick={() => setOpened(true)} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
              {t("learn.video.openQuizNow")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} role="dialog" aria-label={t("learn.video.inVideoQuizLabel", { title })} className="flex size-full flex-col bg-surface-1 text-ink animate-fade-in">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{t("learn.video.inVideoQuizAt", { time: formatTime(active.time) })}</p>
          <p className="truncate text-sm font-semibold">{title}</p>
        </div>
        <Button data-autofocus size="sm" variant="outline" onClick={onContinue} leftIcon={<Icon.Play className="size-3.5" />}>
          {t("learn.video.continue")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 scrollbar-thin">
        <p className="mb-3 text-xs text-ink-muted">{t("learn.video.completeThenContinue")}</p>
        {node ?? (
          <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-ink-muted">{t("learn.video.quizGone")}</p>
        )}
      </div>
    </div>
  );
}
