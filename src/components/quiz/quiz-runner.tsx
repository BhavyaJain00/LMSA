"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ViolationType } from "@/lib/types";
import { checkAnswerAction, getQuizQuestionsAction, logQuizViolationAction, submitQuizAction } from "@/lib/actions/quiz";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn, seededShuffle, uid } from "@/lib/utils";
import { useCountdown, useInterval, useIsFullscreen, useProctoring } from "./runner/hooks";
import { QuizIntro } from "./runner/intro";
import { QuestionView } from "./runner/question-view";
import { AttemptHistory, QuizResults } from "./runner/results";
import { ActivityLog, QuestionNavigator, TimerPill, ViolationBanner, ViolationPill } from "./runner/status";
import { SubmitDialog } from "./runner/submit-dialog";
import {
  getScheduleState,
  violationLabels,
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
  /** Adds the in-video hints ("Complete the quiz to continue the video."). */
  inVideo?: boolean;
  className?: string;
}

function hasAnswer(value: string[] | undefined): boolean {
  return !!value && value.some((v) => v.trim().length > 0);
}

/** Errors after which the attempt can't continue and the learner goes back to the intro. */
const TERMINAL_ERRORS = /maximum number of attempts|schedule for|opens on|no longer exists|not authorized|updated while you were taking it/i;

/**
 * The learner quiz experience: intro card → one question at a time (timer,
 * proctoring, navigator, live answer checks) → results with breakdown and
 * attempt history. Used by the lesson QuizBlock, the standalone /quiz/[id]
 * page and the builder's preview tab.
 */
export function QuizRunner({ payload, mode = "live", lessonId, courseId, backHref, backLabel, inVideo, className }: QuizRunnerProps) {
  const live = mode === "live";
  const meta = payload.quiz;
  const { toast } = useToast();
  const rootRef = useRef<HTMLElement>(null);

  // Quiz content (questions can arrive later when a schedule opens).
  const [questions, setQuestions] = useState<RunnerQuestion[]>(meta.questions);
  const [withheld, setWithheld] = useState(meta.questionsWithheld);
  const [schedule, setSchedule] = useState<ScheduleState>(() => getScheduleState(meta, payload.serverTime));
  const [loadingQuestions, setLoadingQuestions] = useState(false);

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
  const violationsRef = useRef<ViolationEvent[]>([]);
  const submittingRef = useRef(false);
  const pendingLogs = useRef<Promise<unknown>[]>([]);
  const loadingRef = useRef(false);

  const quiz = useMemo(() => ({ ...meta, questions, questionsWithheld: withheld }), [meta, questions, withheld]);
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

  const buildInput = (reason: SubmissionReason): SubmitQuizInput | null => {
    const start = startRef.current;
    if (!start) return null;
    return {
      quizId: meta.id,
      lessonId,
      courseId,
      questionIds: orderRef.current.map((q) => q.id),
      answers: answersRef.current,
      startedAt: start.iso,
      timeTakenSeconds: Math.max(0, Math.round((Date.now() - start.ms) / 1000)),
      violationCount: violationsRef.current.length,
      submissionReason: reason,
      preview: !live,
    };
  };

  /* ---------------------------- Submitting ---------------------------- */

  const submit = async (reason: SubmissionReason) => {
    if (submittingRef.current || phaseRef.current !== "active") return;
    const input = buildInput(reason);
    if (!input) return;
    submittingRef.current = true;
    setConfirmOpen(false);
    setSubmitError(null);
    changePhase("submitting");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    try {
      const res = await submitQuizAction(input);
      if (res.ok) {
        setResult(res.data);
        if (!res.data.preview) setAttempts(res.data.attempts);
        setDeadline(null);
        changePhase("results");
        scrollToTop();
        return;
      }
      failSubmit(res.error, reason);
    } catch {
      failSubmit("Could not submit the quiz. Please try again.", reason);
    }
  };

  const failSubmit = (message: string, reason: SubmissionReason) => {
    toast({ title: message, tone: "error" });
    if (TERMINAL_ERRORS.test(message)) {
      submittingRef.current = false;
      setDeadline(null);
      setStartError(message);
      changePhase("intro");
      return;
    }
    submittingRef.current = false;
    setSubmitError({ message, reason });
    changePhase("active");
  };

  /* ---------------------------- Schedule ---------------------------- */

  const loadQuestions = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingQuestions(true);
    try {
      const res = await getQuizQuestionsAction(meta.id);
      if (res.ok) {
        setQuestions(res.data);
        setWithheld(false);
        setStartError(null);
      } else {
        setStartError(res.error);
      }
    } catch {
      setStartError("Could not load the quiz. Check your connection and try again.");
    } finally {
      loadingRef.current = false;
      setLoadingQuestions(false);
    }
  };

  // Re-check the schedule window every 15s and fetch the questions once it opens.
  useInterval(
    () => {
      const next = getScheduleState(meta, Date.now());
      setSchedule((prev) => (prev.state === next.state ? prev : next));
      if (next.state === "open" && withheld && live) void loadQuestions();
    },
    15000,
    meta.enableScheduling && phase === "intro",
  );

  /* ---------------------------- Starting ---------------------------- */

  const start = () => {
    if (!questions.length) return;
    setStartError(null);
    const seed = uid("attempt");
    const pool = meta.shuffleQuestions ? seededShuffle(questions, seed) : questions;
    const count = Math.min(Math.max(1, meta.questionCount || pool.length), pool.length);
    const list = pool.slice(0, count);
    const startedMs = Date.now();
    const iso = new Date(startedMs).toISOString();

    orderRef.current = list;
    startRef.current = { iso, ms: startedMs };
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
    setDeadline(live && meta.durationSeconds > 0 ? startedMs + meta.durationSeconds * 1000 : null);
    changePhase("active");

    if (proctored) {
      const supported = !!document.fullscreenEnabled && !!rootRef.current?.requestFullscreen;
      setCanFullscreen(supported);
      if (supported && !document.fullscreenElement) rootRef.current?.requestFullscreen().catch(() => undefined);
    }
    scrollToTop();
  };

  const retake = () => {
    submittingRef.current = false;
    startRef.current = null;
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
    toast({ title: "Time's up — submitting your answers.", tone: "warning" });
    void submit("timer_expired");
  });

  const handleViolation = (type: ViolationType) => {
    if (phaseRef.current !== "active" || submittingRef.current) return;
    const start = startRef.current;
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
    toast({ title: `${violationLabels[type]}. Remaining: ${Math.max(0, max - count)}`, tone: "warning" });
    if (start) {
      const logged = logQuizViolationAction({ quizId: meta.id, eventType: type, startedAt: start.iso })
        .then((res) => {
          if (!res.ok) return;
          violationsRef.current = violationsRef.current.map((e) => (e.id === local.id ? res.data.event : e));
          setViolations(violationsRef.current);
        })
        .catch(() => undefined);
      pendingLogs.current.push(logged);
    }
    if (count >= max) {
      void Promise.allSettled(pendingLogs.current).then(() => submit("max_violations"));
    }
  };

  useProctoring(proctored && phase === "active", handleViolation);

  // Leaving the page mid-attempt: warn first, then submit with a beacon if the learner leaves anyway.
  useEffect(() => {
    if (phase !== "active" || !live) return;
    let beaconSent = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onPageHide = () => {
      if (submittingRef.current || !navigator.sendBeacon) return;
      const start = startRef.current;
      if (!start) return;
      const body: SubmitQuizInput = {
        quizId: meta.id,
        lessonId,
        courseId,
        questionIds: orderRef.current.map((q) => q.id),
        answers: answersRef.current,
        startedAt: start.iso,
        timeTakenSeconds: Math.max(0, Math.round((Date.now() - start.ms) / 1000)),
        violationCount: violationsRef.current.length,
        submissionReason: "browser_closed",
      };
      submittingRef.current = true;
      beaconSent = navigator.sendBeacon(`/quiz/${encodeURIComponent(meta.id)}/submit`, new Blob([JSON.stringify(body)], { type: "application/json" }));
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // Restored from the back/forward cache after the beacon submitted the attempt.
      if (e.persisted && beaconSent) window.location.reload();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [phase, live, meta.id, lessonId, courseId]);

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
      toast({ title: q.type === "choices" ? "Please select an option" : "Please type an answer", tone: "warning" });
      return;
    }
    setChecking(true);
    try {
      const res = await checkAnswerAction({ quizId: meta.id, questionId: q.id, answer: ans });
      if (res.ok) setChecks((prev) => ({ ...prev, [q.id]: res.data }));
      else toast({ title: res.error, tone: "error" });
    } catch {
      toast({ title: "Could not check the answer. Please try again.", tone: "error" });
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
      aria-label={`Quiz: ${meta.title}`}
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
              quiz={quiz}
              mode={mode}
              inVideo={inVideo}
              schedule={schedule}
              attemptsUsed={attempts.length}
              canManage={payload.canManage}
              loadingQuestions={loadingQuestions}
              latestPending={latestPending}
              startError={startError}
              onStart={() => {
                if (withheld) void loadQuestions();
                else start();
              }}
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
                {remaining <= 10 ? `${remaining} seconds left` : "Less than a minute left"}
              </p>
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
                  Try again
                </Button>
              </div>
            )}

            {mode === "preview" && (
              <p className="flex items-center gap-2 rounded-lg bg-accent/6 px-3 py-2 text-xs font-medium text-accent">
                <Icon.Eye className="size-4" />
                Preview mode — the timer and proctoring are off and nothing is saved.
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
                    Submitting your answers…
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
          </div>
        )}

        {phase === "results" && result && (
          <div className="space-y-4">
            <QuizResults
              quiz={quiz}
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
