"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ViolationType } from "@/lib/types";
import { checkAnswerAction, logQuizViolationAction, startQuizAttemptAction, submitQuizAction } from "@/lib/actions/quiz";
import { useOptionalLessonRuntime } from "@/components/learn/lesson-runtime";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn, seededShuffle, uid } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { useCountdown, useInterval, useIsFullscreen, useProctoring } from "./runner/hooks";
import { QuizIntro } from "./runner/intro";
import { QuestionView } from "./runner/question-view";
import { AttemptHistory, QuizResults } from "./runner/results";
import { ActivityLog, QuestionNavigator, TimerPill, ViolationBanner, ViolationPill } from "./runner/status";
import { SubmitDialog } from "./runner/submit-dialog";
import {
  getScheduleState,
  type AttemptSummary,
  type CheckAnswerResult,
  type RunnerMode,
  type RunnerPayload,
  type RunnerQuestion,
  type ScheduleState,
  type SubmissionReason,
  type SubmitQuizInput,
  type SubmitResult,
  type ViolationEvent,
} from "./types";

type Phase = "intro" | "active" | "submitting" | "results";

export interface QuizRunnerProps {
  payload: RunnerPayload;
  /** "live" records attempts; "preview" (builder) grades without saving and disables timer/proctoring. */
  mode?: RunnerMode;
  lessonId?: string;
  courseId?: string;
  /** Shown on the results screen (e.g. "Back to lesson" on the standalone quiz page). */
  backHref?: string | null;
  backLabel?: string;
  /** Adds the in-video hints ("Finish this quiz to keep watching the video."). */
  inVideo?: boolean;
  className?: string;
}

function hasAnswer(value: string[] | undefined): boolean {
  return !!value && value.some((v) => v.trim().length > 0);
}

/** Errors after which the attempt can't continue and the learner goes back to the intro. */
const TERMINAL_ERRORS =
  /maximum number of attempts|schedule for|opens on|no longer exists|not authorized|updated while you were taking it|could not be verified|already been submitted/i;

/** A message shown inside the runner while it is fullscreen, where page toasts are not painted. */
interface InlineMessage {
  id: number;
  title: string;
  tone: "warning" | "error";
}

/**
 * The learner quiz experience: intro card → one question at a time (timer,
 * proctoring, navigator, live answer checks) → results with breakdown and
 * attempt history. Used by the lesson QuizBlock, the standalone /quiz/[id]
 * page and the builder's preview tab.
 *
 * Live attempts are issued by the server (`startQuizAttemptAction`): it picks
 * the questions and signs the start time, and the returned token goes back
 * with every proctoring event, answer check and the submission.
 */
export function QuizRunner({ payload, mode = "live", lessonId, courseId, backHref, backLabel, inVideo, className }: QuizRunnerProps) {
  const live = mode === "live";
  const meta = payload.quiz;
  const t = useT("learning");
  const { toast } = useToast();
  const router = useRouter();
  // Present when the runner is embedded in the lesson player (QuizBlock / in-video quiz).
  const lessonRuntime = useOptionalLessonRuntime();
  const rootRef = useRef<HTMLElement>(null);

  const [schedule, setSchedule] = useState<ScheduleState>(() => getScheduleState(meta, payload.serverTime));
  const [starting, setStarting] = useState(false);

  // Attempt state.
  const [phase, setPhase] = useState<Phase>("intro");
  const [order, setOrder] = useState<RunnerQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [review, setReview] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckAnswerResult>>({});
  const [checking, setChecking] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [violations, setViolations] = useState<ViolationEvent[]>([]);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>(payload.attempts);
  const [startError, setStartError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{ message: string; reason: SubmissionReason } | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [inline, setInline] = useState<InlineMessage | null>(null);

  // Keep attempts in sync with fresh server data while no attempt is running.
  const [attemptsProp, setAttemptsProp] = useState(payload.attempts);
  if (payload.attempts !== attemptsProp) {
    setAttemptsProp(payload.attempts);
    if (phase === "intro" || phase === "results") setAttempts(payload.attempts);
  }

  // Values read by event listeners (unload beacon, proctoring, timer).
  const phaseRef = useRef<Phase>("intro");
  const answersRef = useRef<Record<string, string[]>>({});
  const orderRef = useRef<RunnerQuestion[]>([]);
  const startRef = useRef<{ iso: string; ms: number } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const violationsRef = useRef<ViolationEvent[]>([]);
  const submittingRef = useRef(false);
  const pendingLogs = useRef<Promise<unknown>[]>([]);
  const inlineSeq = useRef(0);

  const proctored = live && meta.enableProctoring;
  const isFullscreen = useIsFullscreen();

  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const scrollToTop = () => {
    window.requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el || document.fullscreenElement) return;
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  /**
   * Toast, mirrored inside the runner while it is fullscreen: page toasts
   * live outside the fullscreen element and would not be painted.
   */
  const say = (title: string, tone: InlineMessage["tone"]) => {
    toast({ title, tone });
    if (document.fullscreenElement && rootRef.current?.contains(document.fullscreenElement)) {
      inlineSeq.current += 1;
      setInline({ id: inlineSeq.current, title, tone });
    }
  };

  // Inline messages fade out after a few seconds.
  useEffect(() => {
    if (!inline) return;
    const timer = window.setTimeout(() => setInline((cur) => (cur?.id === inline.id ? null : cur)), 6000);
    return () => window.clearTimeout(timer);
  }, [inline]);

  const buildInput = (reason: SubmissionReason): SubmitQuizInput | null => {
    const start = startRef.current;
    if (!start) return null;
    const base = {
      quizId: meta.id,
      lessonId,
      courseId,
      answers: answersRef.current,
      violationCount: violationsRef.current.length,
      submissionReason: reason,
    };
    if (!live) return { ...base, preview: true, questionIds: orderRef.current.map((q) => q.id), startedAt: start.iso };
    if (!tokenRef.current) return null;
    return { ...base, attemptToken: tokenRef.current };
  };

  /* ---------------------------- Submitting ---------------------------- */

  const submit = async (reason: SubmissionReason) => {
    if (submittingRef.current || phaseRef.current !== "active" || !startRef.current) return;
    submittingRef.current = true;
    setConfirmOpen(false);
    setSubmitError(null);
    changePhase("submitting");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    // Proctoring events still being logged must be stored first, so they are linked to this submission.
    await Promise.allSettled(pendingLogs.current);
    const input = buildInput(reason);
    if (!input) {
      failSubmit(t("quiz.runner.unverified"), reason, true);
      return;
    }
    try {
      const res = await submitQuizAction(input);
      if (res.ok) {
        setResult(res.data);
        setDeadline(null);
        tokenRef.current = null;
        changePhase("results");
        scrollToTop();
        if (!res.data.preview) {
          setAttempts(res.data.attempts);
          onRecorded(res.data);
        }
        return;
      }
      failSubmit(res.error, reason);
    } catch {
      failSubmit(t("quiz.runner.submitFailed"), reason);
    }
  };

  /**
   * After a stored attempt: a passing attempt inside a lesson has already
   * completed the lesson on the server, so flip the lesson player's status
   * right away (its completion panel, badge and "Next" unlock follow) and
   * re-render the server components (outline, progress, attempts).
   */
  const onRecorded = (data: SubmitResult) => {
    if (data.lessonCompleted) {
      toast({ title: t("quiz.runner.lessonCompleted"), description: t("quiz.runner.lessonCompletedBody"), tone: "success" });
      if (lessonRuntime && lessonId && lessonRuntime.lessonId === lessonId && lessonRuntime.status !== "complete") {
        void lessonRuntime.attemptComplete({ silent: true });
      }
    }
    router.refresh();
  };

  /** `terminal` marks client-side errors; server messages are classified by `TERMINAL_ERRORS`. */
  const failSubmit = (message: string, reason: SubmissionReason, terminal = TERMINAL_ERRORS.test(message)) => {
    say(message, "error");
    submittingRef.current = false;
    if (terminal) {
      setDeadline(null);
      tokenRef.current = null;
      setStartError(message);
      changePhase("intro");
      router.refresh();
      return;
    }
    setSubmitError({ message, reason });
    changePhase("active");
  };

  /* ---------------------------- Schedule ---------------------------- */

  // Re-check the schedule window every 15s while the intro is showing.
  useInterval(
    () => {
      const next = getScheduleState(meta, Date.now());
      setSchedule((prev) => (prev.state === next.state ? prev : next));
    },
    15000,
    meta.enableScheduling && phase === "intro",
  );

  /* ---------------------------- Starting ---------------------------- */

  const begin = (list: RunnerQuestion[], start: { iso: string; ms: number }, localDeadline: number | null) => {
    orderRef.current = list;
    startRef.current = start;
    answersRef.current = {};
    violationsRef.current = [];
    pendingLogs.current = [];
    submittingRef.current = false;

    setOrder(list);
    setIndex(0);
    setAnswers({});
    setReview([]);
    setChecks({});
    setViolations([]);
    setResult(null);
    setSubmitError(null);
    setInline(null);
    setDeadline(localDeadline);
    changePhase("active");

    if (proctored) {
      const supported = !!document.fullscreenEnabled && !!rootRef.current?.requestFullscreen;
      setCanFullscreen(supported);
      if (supported && !document.fullscreenElement) rootRef.current?.requestFullscreen().catch(() => undefined);
    }
    scrollToTop();
  };

  const start = async () => {
    if (starting || meta.poolSize === 0) return;
    setStartError(null);

    if (!live) {
      // Preview: the builder hands over every question and nothing is stored.
      const pool = meta.shuffleQuestions ? seededShuffle(meta.questions, uid("attempt")) : meta.questions;
      const count = Math.min(Math.max(1, meta.questionCount || pool.length), pool.length);
      const startedMs = Date.now();
      tokenRef.current = null;
      begin(pool.slice(0, count), { iso: new Date(startedMs).toISOString(), ms: startedMs }, null);
      return;
    }

    setStarting(true);
    try {
      const res = await startQuizAttemptAction(meta.id);
      if (!res.ok) {
        setStartError(res.error);
        return;
      }
      if (!res.data.questions.length) {
        setStartError(t("quiz.noQuestions"));
        return;
      }
      const { token, startedAt, serverTime, questions } = res.data;
      const startedServerMs = Date.parse(startedAt);
      // Map the server-side start onto the local clock so clock skew doesn't shorten or extend the timer.
      const localStart = Date.now() - Math.max(0, serverTime - startedServerMs);
      tokenRef.current = token;
      begin(
        questions,
        { iso: startedAt, ms: localStart },
        meta.durationSeconds > 0 ? localStart + meta.durationSeconds * 1000 : null,
      );
    } catch {
      setStartError(t("quiz.runner.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const retake = () => {
    submittingRef.current = false;
    startRef.current = null;
    tokenRef.current = null;
    setResult(null);
    setOrder([]);
    setStartError(null);
    changePhase("intro");
    scrollToTop();
  };

  const returnToFullscreen = () => {
    if (!document.fullscreenElement) rootRef.current?.requestFullscreen().catch(() => undefined);
  };

  /* ---------------------------- Timer & proctoring ---------------------------- */

  const remaining = useCountdown(phase === "active" ? deadline : null, () => {
    say(t("quiz.runner.timeUp"), "warning");
    void submit("timer_expired");
  });

  const handleViolation = (type: ViolationType) => {
    if (phaseRef.current !== "active" || submittingRef.current) return;
    const token = tokenRef.current;
    const max = Math.max(1, meta.maxViolations);
    const count = violationsRef.current.length + 1;
    const local: ViolationEvent = {
      id: `local_${count}_${Date.now()}`,
      eventType: type,
      severity: count >= max ? "violation" : "warning",
      timestamp: new Date().toISOString(),
    };
    violationsRef.current = [...violationsRef.current, local];
    setViolations(violationsRef.current);
    // The in-tree ViolationBanner already shows this while fullscreen.
    toast({ title: t("quiz.runner.violationToast", { violation: t(`quiz.violation.${type}`), count: Math.max(0, max - count) }), tone: "warning" });
    if (token) {
      const logged = logQuizViolationAction({ quizId: meta.id, eventType: type, attemptToken: token })
        .then((res) => {
          if (!res.ok) return;
          violationsRef.current = violationsRef.current.map((e) => (e.id === local.id ? res.data.event : e));
          setViolations(violationsRef.current);
        })
        .catch(() => undefined);
      pendingLogs.current.push(logged);
    }
    if (count >= max) void submit("max_violations");
  };

  useProctoring(proctored && phase === "active", handleViolation);

  /** Submit the running attempt with a beacon (survives the page going away). */
  const sendBeacon = (): boolean => {
    if (!live || submittingRef.current || !navigator.sendBeacon) return false;
    const body = buildInput("browser_closed");
    if (!body) return false;
    submittingRef.current = true;
    return navigator.sendBeacon(`/quiz/${encodeURIComponent(meta.id)}/submit`, new Blob([JSON.stringify(body)], { type: "application/json" }));
  };
  const sendBeaconRef = useRef(sendBeacon);
  useEffect(() => {
    sendBeaconRef.current = sendBeacon;
  });

  // Leaving the page mid-attempt: warn first, then submit with a beacon if the learner leaves anyway.
  // In-app links are intercepted too (they would unmount the runner without any prompt).
  useEffect(() => {
    if (phase !== "active" || !live) return;
    let beaconSent = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onPageHide = () => {
      beaconSent = sendBeaconRef.current() || beaconSent;
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // Restored from the back/forward cache after the beacon submitted the attempt.
      if (e.persisted && beaconSent) window.location.reload();
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("click", onClick, true);
    };
  }, [phase, live]);

  // Unmounted mid-attempt by a navigation we could not intercept (browser back, programmatic
  // routing): hand the attempt in rather than letting it vanish.
  useEffect(() => {
    return () => {
      if (phaseRef.current === "active") sendBeaconRef.current();
    };
  }, []);

  /** The learner confirmed leaving through an in-app link: hand the attempt in, then navigate. */
  const leaveAttempt = async () => {
    const href = leaveHref;
    if (!href || leaving) return;
    setLeaving(true);
    const input = submittingRef.current ? null : buildInput("browser_closed");
    if (input) {
      submittingRef.current = true;
      changePhase("submitting");
      await Promise.allSettled(pendingLogs.current);
      try {
        await submitQuizAction({ ...input, violationCount: violationsRef.current.length });
      } catch {
        // Navigating anyway: the learner chose to leave.
      }
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    setLeaveHref(null);
    setLeaving(false);
    router.push(href);
  };

  /* ---------------------------- Answering ---------------------------- */

  const setAnswer = (questionId: string, value: string[]) => {
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
  };

  const goTo = (i: number) => {
    setIndex(Math.max(0, Math.min(order.length - 1, i)));
    scrollToTop();
  };

  const check = async () => {
    const q = order[index];
    if (!q) return;
    const ans = answersRef.current[q.id] ?? [];
    if (!hasAnswer(ans)) {
      say(q.type === "choices" ? t("quiz.runner.selectOption") : t("quiz.runner.typeAnswer"), "warning");
      return;
    }
    setChecking(true);
    try {
      const res = await checkAnswerAction({ quizId: meta.id, questionId: q.id, answer: ans, attemptToken: tokenRef.current ?? undefined });
      if (res.ok) setChecks((prev) => ({ ...prev, [q.id]: res.data }));
      else say(res.error, "error");
    } catch {
      say(t("quiz.runner.checkFailed"), "error");
    } finally {
      setChecking(false);
    }
  };

  const toggleReview = (id: string) => setReview((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /* ---------------------------- Render ---------------------------- */

  const answeredCount = order.filter((q) => hasAnswer(answers[q.id])).length;
  const current = order[index];
  const showStatusBar = (phase === "active" || phase === "submitting") && ((live && meta.durationSeconds > 0) || proctored);
  const canRetake = !live || meta.maxAttempts === 0 || attempts.length < meta.maxAttempts;
  const latestPending = attempts[0]?.pendingGrading ?? false;

  return (
    <section
      ref={rootRef}
      aria-label={t("quiz.runner.label", { title: meta.title })}
      className={cn(
        "@container relative scroll-mt-20",
        "[&:fullscreen]:overflow-y-auto [&:fullscreen]:bg-surface [&:fullscreen]:p-4 sm:[&:fullscreen]:p-8",
        className,
      )}
    >
      <div className="[:fullscreen_&]:mx-auto [:fullscreen_&]:max-w-4xl">
        {phase === "intro" && (
          <div className="space-y-4">
            <QuizIntro
              quiz={meta}
              mode={mode}
              inVideo={inVideo}
              schedule={schedule}
              attemptsUsed={attempts.length}
              canManage={payload.canManage}
              loadingQuestions={starting}
              latestPending={latestPending}
              startError={startError}
              onStart={() => void start()}
            />
            {live && meta.showSubmissionHistory && attempts.length > 0 && <AttemptHistory attempts={attempts} />}
          </div>
        )}

        {(phase === "active" || phase === "submitting") && current && (
          <div className="space-y-4">
            {showStatusBar && (
              <div className="sticky top-16 z-20 flex items-center justify-between gap-2 rounded-full border border-border bg-surface-1/95 px-2 py-1.5 shadow-card backdrop-blur [:fullscreen_&]:top-2">
                <span className="truncate px-2 text-sm font-medium text-ink">{meta.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {live && meta.durationSeconds > 0 && <TimerPill remaining={remaining ?? meta.durationSeconds} total={meta.durationSeconds} />}
                  {proctored && <ViolationPill count={violations.length} max={meta.maxViolations} />}
                </span>
              </div>
            )}
            {remaining !== null && remaining <= 60 && remaining > 0 && (
              <p className="sr-only" aria-live="assertive">
                {remaining <= 10 ? t("quiz.runner.secondsLeft", { count: remaining }) : t("quiz.runner.lessThanMinute")}
              </p>
            )}

            {inline && isFullscreen && (
              <div
                role={inline.tone === "error" ? "alert" : "status"}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-ink",
                  inline.tone === "error" ? "border-danger/30 bg-danger/8" : "border-warning/40 bg-warning/10",
                )}
              >
                <Icon.AlertCircle className={cn("size-5 shrink-0", inline.tone === "error" ? "text-danger" : "text-warning")} />
                <p className="min-w-0 flex-1">{inline.title}</p>
              </div>
            )}

            {proctored && (
              <ViolationBanner
                events={violations}
                max={meta.maxViolations}
                fullscreen={isFullscreen}
                canFullscreen={canFullscreen}
                onReturnToFullscreen={returnToFullscreen}
              />
            )}

            {submitError && (
              <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 sm:flex-row sm:items-center">
                <Icon.AlertCircle className="size-5 shrink-0 text-danger" />
                <p className="min-w-0 flex-1 text-sm text-ink">{submitError.message}</p>
                <Button size="sm" onClick={() => void submit(submitError.reason)} leftIcon={<Icon.Refresh className="size-4" />}>
                  {t("quiz.runner.tryAgain")}
                </Button>
              </div>
            )}

            {mode === "preview" && (
              <p className="flex items-center gap-2 rounded-lg bg-accent/6 px-3 py-2 text-xs font-medium text-accent">
                <Icon.Eye className="size-4" />
                {t("quiz.runner.previewBanner")}
              </p>
            )}

            <div className={cn("relative grid gap-4", !meta.showAnswers && order.length > 1 && "@3xl:grid-cols-[minmax(0,1fr)_15rem]")}>
              <QuestionView
                key={current.id}
                question={current}
                index={index}
                total={order.length}
                answer={answers[current.id] ?? []}
                onAnswer={(value) => setAnswer(current.id, value)}
                check={checks[current.id]}
                showAnswers={meta.showAnswers}
                checking={checking}
                busy={phase === "submitting"}
                reviewMarked={review.includes(current.id)}
                onToggleReview={() => toggleReview(current.id)}
                onPrev={() => goTo(index - 1)}
                onNext={() => goTo(index + 1)}
                onCheck={() => void check()}
                onSubmit={() => setConfirmOpen(true)}
              />
              {!meta.showAnswers && order.length > 1 && (
                <QuestionNavigator
                  questions={order}
                  current={index}
                  answered={(id) => hasAnswer(answers[id])}
                  review={review}
                  onJump={goTo}
                  disabled={phase === "submitting"}
                />
              )}
              {phase === "submitting" && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-surface-1/70 backdrop-blur-[1px]" role="status">
                  <span className="inline-flex items-center gap-2 rounded-full bg-surface-1 px-4 py-2 text-sm font-medium text-ink shadow-pop">
                    <Spinner className="size-4" />
                    {t("quiz.runner.submitting")}
                  </span>
                </div>
              )}
            </div>

            {proctored && <ActivityLog events={violations} />}

            <SubmitDialog
              open={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              onConfirm={() => void submit("manual")}
              total={order.length}
              answered={answeredCount}
              review={review.length}
              preview={!live}
            />

            <ConfirmDialog
              open={leaveHref !== null}
              onClose={() => setLeaveHref(null)}
              onConfirm={leaveAttempt}
              loading={leaving}
              destructive
              confirmLabel={t("quiz.leave.confirm")}
              cancelLabel={t("quiz.leave.cancel")}
              title={t("quiz.leave.title")}
              description={t("quiz.leave.body")}
            />
          </div>
        )}

        {phase === "results" && result && (
          <div className="space-y-4">
            <QuizResults
              quiz={meta}
              mode={mode}
              result={result}
              attempts={attempts}
              canRetake={canRetake}
              onRetake={retake}
              backHref={backHref}
              backLabel={backLabel}
            />
            {proctored && violations.length > 0 && <ActivityLog events={violations} />}
          </div>
        )}
      </div>
    </section>
  );
}
